using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace FrameFlow.Capture;

// WASAPI device positions preserve continuity; QPC anchors PCM to the video clock.
internal sealed class LiveAudioTrack
{
    private readonly MMDevice device;
    private readonly AudioClient client;
    private readonly WaveFormat format;
    private readonly CaptureClock clock;
    private readonly AudioPacketPlanner planner;
    private readonly LiveAudioResampler converter;
    private readonly byte[] bytes;
    private readonly Action<Exception> failed;
    private readonly ManualResetEventSlim cancelled = new(false);
    private readonly TaskCompletionSource completed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource first = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private Thread? worker;
    private double lastPacket;
    internal double LastPacket => Volatile.Read(ref lastPacket);

    internal LiveAudioTrack(bool loopback, string? id, CaptureClock clock,
        Action<float[], int, double> publish, Action<Exception> failed)
    {
        this.clock = clock; this.failed = failed;
        using var catalog = new MMDeviceEnumerator();
        device = !loopback && !string.IsNullOrWhiteSpace(id) ? MicrophoneCatalog.OpenSelected(id)
            : catalog.GetDefaultAudioEndpoint(loopback ? DataFlow.Render : DataFlow.Capture, Role.Multimedia);
        AudioClient? opened = null;
        try
        {
            client = opened = device.AudioClient; format = client.MixFormat;
            planner = new AudioPacketPlanner(format.SampleRate, loopback);
            client.Initialize(AudioClientShareMode.Shared, loopback ? AudioClientStreamFlags.Loopback : 0,
                1_000_000, 0, format, Guid.Empty);
            bytes = new byte[Math.Max(1, client.BufferSize) * format.BlockAlign];
            converter = new LiveAudioResampler(format, publish);
        }
        catch { opened?.Dispose(); device.Dispose(); throw; }
    }
    internal void Start()
    {
        var thread = new Thread(ReadLoop) { IsBackground = true, Name = "XiaoLu live audio" };
        try { client.Start(); worker = thread; thread.Start(); }
        catch { worker = null; Cleanup(); completed.TrySetResult(); throw; }
    }
    internal async Task WaitForFirstPacketAsync(CancellationToken token)
    {
        try { await first.Task.WaitAsync(TimeSpan.FromSeconds(3), token); }
        catch (TimeoutException) { throw new IOException("直播麦克风没有传入声音，请检查权限和设备。"); }
    }
    private void ReadLoop()
    {
        try { while (!cancelled.IsSet) { Drain(); cancelled.Wait(8); } }
        catch (Exception error) { first.TrySetException(error); if (!cancelled.IsSet) failed(error); }
        finally
        {
            try { Cleanup(); }
            catch (Exception error) { if (!cancelled.IsSet) failed(error); }
            finally { completed.TrySetResult(); }
        }
    }
    private void Drain()
    {
        var capture = client.AudioCaptureClient;
        for (var packet = 0; packet < 64 && !cancelled.IsSet && capture.GetNextPacketSize() > 0; packet++)
        {
            var pointer = capture.GetBuffer(out var frames, out var flags, out var position, out var qpc);
            try
            {
                var length = checked(frames * format.BlockAlign);
                if (length < 0 || length > bytes.Length) throw new IOException("直播声音缓冲区尺寸无效。");
                if ((flags & AudioClientBufferFlags.Silent) != 0) Array.Clear(bytes, 0, length);
                else Marshal.Copy(pointer, bytes, 0, length);
            }
            finally { capture.ReleaseBuffer(frames); }
            if (frames == 0) continue;
            var now = clock.Seconds; var timestamp = clock.FromAudioTimestamp(qpc);
            var valid = (flags & AudioClientBufferFlags.TimestampError) == 0 && double.IsFinite(timestamp)
                && timestamp >= 0 && timestamp <= now + .25;
            var plan = planner.Plan(position, frames, valid ? timestamp : null, now,
                (flags & AudioClientBufferFlags.DataDiscontinuity) != 0);
            converter.Append(bytes, plan, planner.WrittenFrames);
            Volatile.Write(ref lastPacket, now); first.TrySetResult();
        }
    }
    private void Cleanup()
    {
        try { client.Stop(); } catch { /* A disconnected driver must not prevent release. */ }
        try { client.Dispose(); } finally { device.Dispose(); }
    }
    internal async Task StopAsync()
    {
        cancelled.Set();
        if (worker is null) return;
        // A stuck driver retains its own background thread/resources until it returns.
        await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }
}
