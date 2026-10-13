namespace FrameFlow.Capture;

/** A bounded, audio-only trial uses the same WASAPI endpoint and packet planner as recording. */
internal sealed class MicrophoneTrial : IAsyncDisposable
{
    private readonly string directory;
    private readonly CaptureClock clock = new();
    private readonly AudioTrack track;
    private readonly CancellationTokenSource timeout = new();
    private readonly object gate = new();
    private Task<object>? stopped;
    private Exception? failure;
    private double origin;

    private MicrophoneTrial(string directory, string? deviceId)
    {
        this.directory = directory;
        Directory.CreateDirectory(directory);
        track = new AudioTrack(directory, "microphone", false, clock,
            error => failure = error, new SessionDiagnostics(directory), deviceId);
    }

    internal static async Task<MicrophoneTrial> StartAsync(string directory, string? deviceId, CancellationToken cancellation)
    {
        var trial = new MicrophoneTrial(directory, deviceId);
        try
        {
            trial.track.Start();
            await trial.track.WaitForFirstPacketAsync(cancellation);
            trial.origin = trial.clock.Seconds;
            _ = trial.StopAfterLimitAsync();
            return trial;
        }
        catch { await trial.DisposeAsync(); throw; }
    }

    private async Task StopAfterLimitAsync()
    {
        try { await Task.Delay(TimeSpan.FromSeconds(10), timeout.Token); await StopAsync(); }
        catch (OperationCanceledException) { }
        catch (Exception error) { failure = error; }
    }

    internal Task<object> StopAsync()
    {
        lock (gate) return stopped ??= FinishAsync();
    }

    private async Task<object> FinishAsync()
    {
        timeout.Cancel();
        var duration = Math.Max(.01, clock.Seconds - origin);
        await track.StopAsync();
        if (failure is not null) throw new IOException("麦克风试录中断：" + failure.Message, failure);
        if (!track.HasPackets) throw new IOException("麦克风未传入音频，请选择其他设备。");
        AudioTrack.Align(directory, "microphone", origin, duration);
        return new { duration, file = Path.Combine(directory, "microphone.wav") };
    }

    public async ValueTask DisposeAsync()
    {
        try { await StopAsync(); }
        catch { /* Trial is disposable; full recordings use their separate recovery lifecycle. */ }
        finally { track.Dispose(); timeout.Dispose(); }
    }
}
