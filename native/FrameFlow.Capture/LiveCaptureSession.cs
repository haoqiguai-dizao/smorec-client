namespace FrameFlow.Capture;

// Keep the frame pipe, output dimensions and clock alive while changing capture exclusions.
internal sealed class LiveCaptureSession : IAsyncDisposable
{
    private readonly CaptureClock clock = new();
    private readonly LiveFrameServer frames;
    private RecordingOptions options;
    private LiveCaptureProducer? producer;
    private readonly LiveAudioCapture? audio;
    private bool disposed;
    private readonly string[] ownExcludedHandles;
    private string? boardWindow;
    private bool demoVisible;
    internal int Width { get; }
    internal int Height { get; }
    internal double StartedAtUnixMs => clock.ToUnixMilliseconds(0);

    private LiveCaptureSession(RecordingOptions options, string pipeName)
    {
        this.options = options;
        ownExcludedHandles = options.ExcludeWindowHandles ?? [];
        var selection = SourceCatalog.Select(options with { Resolution = "1080p" });
        Width = selection.Width; Height = selection.Height;
        if (options.LiveAudio) audio = new LiveAudioCapture(options, clock, Fail);
        frames = new LiveFrameServer(pipeName, Width, Height, Fail, () => clock.Seconds,
            audio is null ? null : audio.Pull);
    }

    private static void Fail(Exception error) => Protocol.Write(new { @event = "live-error", error = error.Message });

    internal static async Task<LiveCaptureSession> StartAsync(RecordingOptions options, string pipeName, CancellationToken token)
    {
        var session = new LiveCaptureSession(options, pipeName);
        try
        {
            session.frames.Start();
            await session.StartProducer(options, token);
            if (session.audio is not null) await session.audio.StartAsync(options, token);
            return session;
        }
        catch { await session.DisposeAsync(); throw; }
    }

    private RecordingOptions Resolve(RecordingOptions value)
    {
        var current = LiveWindowExclusions.Current(LiveWindowExclusions.Snapshot(value), LiveWindowExclusions.IsCurrent);
        var merged = LiveWindowExclusions.Merge(value, current);
        var selection = SourceCatalog.Select(merged with { Resolution = "1080p" });
        if (selection.Width != Width || selection.Height != Height)
            throw new InvalidOperationException("投屏来源尺寸已变化，请重新选择来源。");
        return merged;
    }

    private async Task StartProducer(RecordingOptions value, CancellationToken token)
    {
        Resolve(value);
        producer = await LiveCaptureProducer.StartAsync(value, frames, clock, frames.Generation, token);
    }

    internal async Task SetExcludedApplicationsAsync(string[] applications, CancellationToken token)
    {
        if (disposed || producer is null) throw new InvalidOperationException("投屏会话已结束。");
        var next = options with { ExcludedApplications = LiveWindowExclusions.NormalizeApplications(applications) };
        await UpdateProducerAsync(next, token);
    }

    internal Task<LiveAudioOptions> SetAudioAsync(LiveAudioOptions value, CancellationToken token) =>
        (audio ?? throw new InvalidOperationException("声音在直播伴侣中设置。")).SetEnabledAsync(value.System, value.Microphone, token);

    internal async Task SetDemoVisibleAsync(bool visible, CancellationToken token)
    {
        if (!options.SourceId.StartsWith("screen:")) throw new InvalidOperationException("演示全部界面请使用屏幕或区域直播。");
        var handles = visible ? Array.Empty<string>() : ownExcludedHandles;
        if (boardWindow is not null) handles = handles.Where(handle => handle != boardWindow).ToArray();
        await UpdateProducerAsync(options with { ExcludeWindowHandles = handles }, token);
        demoVisible = visible;
    }

    internal async Task SetWhiteboardAsync(WhiteboardPresentationOptions value, CancellationToken token)
    {
        if (!value.Visible && !options.SourceId.StartsWith("screen:")) return;
        if (!options.SourceId.StartsWith("screen:")) throw new InvalidOperationException("完整白板界面请使用屏幕或区域直播。");
        var handles = demoVisible ? Array.Empty<string>() : ownExcludedHandles;
        if (value.Visible) handles = handles.Where(handle => handle != value.WindowId).ToArray();
        await UpdateProducerAsync(options with { ExcludeWindowHandles = handles }, token);
        boardWindow = value.Visible ? value.WindowId : null;
    }

    private async Task UpdateProducerAsync(RecordingOptions next, CancellationToken token)
    {
        if (disposed || producer is null) throw new InvalidOperationException("投屏会话已结束。");
        Resolve(next); // Validate HWNDs before changing the running capture.
        // Explicit refresh must reapply even unchanged HWNDs: a previously hidden window may now be shown.
        frames.BeginUpdate(); // Blank the pending frame and ignore callbacks from the old producer.
        var previous = producer; producer = null;
        try { await previous.DisposeAsync(); }
        catch (Exception error) { Fail(error); throw; }
        try
        {
            await StartProducer(next, token);
            options = next;
        }
        catch (Exception error)
        {
            frames.BeginUpdate();
            try { await StartProducer(options, token); }
            catch (Exception restoreError)
            {
                var failure = new AggregateException("排除应用更新失败，恢复采集也失败。", error, restoreError);
                Fail(failure); throw failure;
            }
            throw new InvalidOperationException("排除应用更新失败，已恢复原来的选择。" + error.Message, error);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        frames.BeginUpdate();
        var active = producer; producer = null;
        await LiveCaptureStartup.CleanupAsync(
            () => audio?.DisposeAsync() ?? ValueTask.CompletedTask,
            () => active?.DisposeAsync() ?? ValueTask.CompletedTask, frames.DisposeAsync);
    }
}
