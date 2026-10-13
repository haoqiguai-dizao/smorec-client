using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace FrameFlow.Capture;

internal sealed class AudioTrack : IDisposable
{
    private readonly MMDevice device;
    private readonly AudioClient client;
    private readonly WaveFileWriter writer;
    private readonly CaptureClock clock;
    private readonly WaveFormat format;
    private readonly AudioPacketPlanner planner;
    private readonly ManualResetEventSlim cancellation = new(false);
    private readonly TaskCompletionSource completed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource firstPacket = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly byte[] buffer;
    private readonly byte[] silence = new byte[65536];
    private readonly Action<Exception> failure;
    private readonly SessionDiagnostics log;
    private readonly AudioMuteGate mute = new();
    private readonly DictationTap dictation;
    private Thread? worker;
    private long written;
    private long receivedFrames;
    private double flushAt;
    private int cleaned;
    private bool timestampWarning;
    private long packets;
    private long silentPackets;
    internal string Name { get; }
    internal bool HasPackets => Interlocked.Read(ref receivedFrames) > 0;
    internal bool Finished => completed.Task.IsCompleted;
    internal bool Muted => mute.Muted;
    internal string DeviceName { get; }
    internal void SetMuted(bool value) => mute.Set(value);

    internal AudioTrack(string directory, string name, bool loopback, CaptureClock clock,
        Action<Exception> failure, SessionDiagnostics log, string? deviceId = null)
    {
        this.clock = clock; this.failure = failure; this.log = log; Name = name;
        using var devices = new MMDeviceEnumerator();
        device = !loopback && !string.IsNullOrWhiteSpace(deviceId) ? MicrophoneCatalog.OpenSelected(deviceId)
            : devices.GetDefaultAudioEndpoint(loopback ? DataFlow.Render : DataFlow.Capture, Role.Multimedia);
        AudioClient? openedClient = null;
        WaveFileWriter? openedWriter = null;
        try
        {
            // Keep diagnostics usable after the worker has released the COM endpoint.
            DeviceName = device.FriendlyName;
            client = openedClient = device.AudioClient;
            format = client.MixFormat;
            dictation = new DictationTap(format);
            planner = new AudioPacketPlanner(format.SampleRate, loopback);
            client.Initialize(AudioClientShareMode.Shared, loopback ? AudioClientStreamFlags.Loopback : 0,
                1_000_000, 0, format, Guid.Empty);
            buffer = new byte[Math.Max(1, client.BufferSize) * format.BlockAlign];
            writer = openedWriter = new WaveFileWriter(Path.Combine(directory, name + ".recovery.wav"), format);
            // Persist the header even when a disconnected/muted endpoint never sends a packet.
            writer.Flush();
            log.Write("audio-initialized", new { name, deviceId = device.ID, deviceName = DeviceName,
                format.SampleRate, format.Channels, format.BitsPerSample, format.BlockAlign, format.AverageBytesPerSecond,
                encoding = format.Encoding.ToString(), subFormat = (format as WaveFormatExtensible)?.SubFormat,
                client.BufferSize });
        }
        catch { openedWriter?.Dispose(); openedClient?.Dispose(); device.Dispose(); throw; }
    }

    internal void Start()
    {
        // Recording callbacks must not starve behind the CLR ThreadPool while 4K encoding is busy.
        var thread = new Thread(ReadLoop) { IsBackground = true, Name = $"FrameFlow {Name} audio" };
        try
        {
            client.Start();
            worker = thread;
            thread.Start();
        }
        catch
        {
            // A thread that never started cannot complete ReadLoop's cleanup signal.
            worker = null;
            try { client.Stop(); }
            catch (Exception ex) { log.Write("audio-start-cleanup-warning", new { Name }, ex); }
            Cleanup();
            completed.TrySetResult();
            throw;
        }
        log.Write("audio-started", new { Name, time = clock.Seconds });
    }

    internal async Task WaitForFirstPacketAsync(CancellationToken token)
    {
        try { await firstPacket.Task.WaitAsync(TimeSpan.FromSeconds(3), token); }
        catch (TimeoutException)
        {
            log.Write("audio-no-initial-packet", new { Name, deviceName = DeviceName });
            throw new InvalidOperationException($"麦克风“{DeviceName}”没有传入音频。请在麦克风菜单选择其他输入设备，或关闭麦克风后再开始。");
        }
    }

    private void ReadLoop()
    {
        try
        {
            while (!cancellation.IsSet)
            {
                DrainPackets();
                cancellation.Wait(8);
            }
        }
        catch (Exception ex) { firstPacket.TrySetException(ex); failure(ex); }
        finally
        {
            try { client.Stop(); }
            catch (Exception ex) { log.Write("audio-stop-driver-warning", new { Name }, ex); }
            Cleanup();
            log.Write("audio-stopped", new { Name, receivedFrames, written, packets, silentPackets,
                planner.LeadingFrames, planner.GapFrames, planner.SkippedFrames, planner.Discontinuities,
                planner.TimestampErrors, planner.Resets, planner.TimestampGapResyncs, planner.MaximumTimestampDriftMs });
            completed.TrySetResult();
        }
    }

    private void DrainPackets()
    {
        var capture = client.AudioCaptureClient;
        // Both cancellation and packet count bound this loop even if a driver keeps replenishing it.
        for (var packet = 0; packet < 64 && !cancellation.IsSet && capture.GetNextPacketSize() > 0; packet++)
        {
            var pointer = capture.GetBuffer(out var frames, out var flags, out var devicePosition, out var qpc);
            try
            {
                var count = checked(frames * format.BlockAlign);
                if (count > buffer.Length || count < 0) throw new IOException("WASAPI 返回了无效的音频缓冲区尺寸。");
                if ((flags & AudioClientBufferFlags.Silent) != 0) Array.Clear(buffer, 0, count);
                else Marshal.Copy(pointer, buffer, 0, count);
            }
            finally { capture.ReleaseBuffer(frames); }
            // The WASAPI packet is now released; disk IO and diagnostics cannot hold it.
            if (frames == 0) continue;
            var now = clock.Seconds;
            var start = clock.FromAudioTimestamp(qpc);
            double? timestamp = start;
            if ((flags & AudioClientBufferFlags.TimestampError) != 0 || !double.IsFinite(start) || start < 0 || start > now + .25)
            {
                if (!timestampWarning) { log.Write("audio-timestamp-fallback", new { Name, qpc, start, now }); timestampWarning = true; }
                timestamp = null;
            }
            var plan = planner.Plan(devicePosition, frames, timestamp, now,
                (flags & AudioClientBufferFlags.DataDiscontinuity) != 0);
            var padding = checked(plan.SilenceFrames * format.BlockAlign);
            var skip = checked(plan.SkipFrames * format.BlockAlign);
            var countToWrite = checked(plan.WriteFrames * format.BlockAlign);
            CheckLimit(padding + countToWrite);
            WriteSilence(padding);
            dictation.Append(buffer, skip, countToWrite);
            mute.Apply(buffer, skip, countToWrite);
            writer.Write(buffer, skip, countToWrite);
            written += countToWrite;
            packets++;
            if ((flags & AudioClientBufferFlags.Silent) != 0) silentPackets++;
            Interlocked.Add(ref receivedFrames, frames);
            if (now >= flushAt) { writer.Flush(); flushAt = now + 1; }
            // Do not announce readiness before the first packet's write/flush and
            // driver buffer release have succeeded. Silent packets still qualify.
            if (frames > 0) firstPacket.TrySetResult();
        }
    }

    private void CheckLimit(long count)
    {
        if (written + count > uint.MaxValue - 65536)
            throw new IOException("音轨达到 WAV 的 4 GB 上限；视频仍会继续保存。");
    }
    private void WriteSilence(long count)
    {
        CheckLimit(count);
        while (count > 0)
        {
            var length = (int)Math.Min(count, silence.Length);
            writer.Write(silence, 0, length); count -= length; written += length;
        }
    }

    internal Task BeginDictationAsync(string directory, string id, CancellationToken token) => dictation.BeginAsync(directory, id, token);
    internal object EndDictation(string id) => dictation.End(id);
    internal void CancelDictation(string id) => dictation.Cancel(id);

    internal async Task StopAsync()
    {
        cancellation.Set();
        if (worker is not null) await completed.Task.WaitAsync(TimeSpan.FromSeconds(5));
        else { Cleanup(); completed.TrySetResult(); }
    }

    internal static void Align(string directory, string name, double origin, double duration)
    {
        using var input = new WaveFileReader(Path.Combine(directory, name + ".recovery.wav"));
        using var output = new WaveFileWriter(Path.Combine(directory, name + ".wav"), input.WaveFormat);
        var alignment = input.WaveFormat.BlockAlign;
        var bytesPerSecond = input.WaveFormat.AverageBytesPerSecond;
        var start = (long)(Math.Max(0, origin) * bytesPerSecond) / alignment * alignment;
        var total = (long)(duration * bytesPerSecond) / alignment * alignment;
        input.Position = Math.Min(start, input.Length);
        var copy = new byte[65536 / alignment * alignment];
        while (total > 0)
        {
            var requested = (int)Math.Min(total, copy.Length);
            var read = input.Read(copy, 0, requested);
            if (read < requested) Array.Clear(copy, read, requested - read);
            output.Write(copy, 0, requested); total -= requested;
        }
    }

    private void Cleanup()
    {
        if (Interlocked.Exchange(ref cleaned, 1) != 0) return;
        // A failed device cannot prevent the other device or video encoder from being released.
        foreach (var resource in new IDisposable[] { dictation, writer, client, device })
        {
            try { resource.Dispose(); }
            catch (Exception ex) { log.Write("audio-resource-warning", new { Name, resource = resource.GetType().Name }, ex); }
        }
    }

    public void Dispose()
    {
        cancellation.Set();
        if (worker is null || completed.Task.IsCompleted) Cleanup();
        // A stuck driver owns its background thread and is abandoned instead of hanging video save.
        // The worker itself disposes its COM resources if the driver call eventually returns.
    }
}
