using System.Collections.Concurrent;
using System.Text.Json;

namespace FrameFlow.Capture;

internal sealed class RecordingSession : IAsyncDisposable
{
    private readonly string directory;
    private RecordingOptions options;
    private readonly string[]? ownExcludedHandles;
    private readonly SourceSelection selection;
    private readonly CaptureClock clock = new();
    private readonly SessionDiagnostics log;
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private readonly CancellationTokenSource cancellation = new();
    private readonly ConcurrentQueue<string> warnings = new();
    private readonly object stopGate = new();
    private VideoCapture? video;
    private WhiteboardCapture? whiteboard;
    private CursorRecorder? cursor;
    private InputActivityRecorder? inputActivity;
    private AudioCaptureGroup? audio;
    private Task<NativeRecordingResult>? stopping;
    private Exception? failure;
    private string status = "starting";
    private bool disposed;
    private bool demoVisible;
    internal double StartedAtUnixMs => clock.ToUnixMilliseconds(video?.Origin ?? 0);
    internal string[] Warnings => warnings.ToArray();
    internal Task BeginDictationAsync(string target, string id, CancellationToken token) =>
        (audio ?? throw new InvalidOperationException("麦克风尚未就绪。")).BeginDictationAsync(target, id, token);
    internal object EndDictation(string id) => (audio ?? throw new InvalidOperationException("录制已结束。")).EndDictation(id);
    internal void CancelDictation(string id) => audio?.CancelDictation(id);

    private RecordingSession(string directory, RecordingOptions options)
    {
        this.directory = Path.GetFullPath(directory);
        ownExcludedHandles = options.ExcludeWindowHandles;
        this.options = LiveWindowExclusions.ForRecording(options);
        Directory.CreateDirectory(this.directory);
        if (Directory.EnumerateFileSystemEntries(this.directory).Any())
            throw new ArgumentException("录制目录必须为空，防止覆盖已有工程。");
        log = new SessionDiagnostics(this.directory);
        log.Write("session-created", new { options, os = Environment.OSVersion.VersionString, runtime = Environment.Version.ToString() });
        try { selection = SourceCatalog.Select(this.options); }
        catch (Exception ex) { log.Write("source-unavailable", error: ex); throw new InvalidOperationException(log.Explain(ex), ex); }
    }

    internal static async Task<RecordingSession> StartAsync(string directory, RecordingOptions options, CancellationToken parentClosed = default)
    {
        var session = new RecordingSession(directory, options);
        try { await session.InitializeAsync(parentClosed); return session; }
        catch (Exception ex)
        {
            session.log.Write("session-start-failed", error: ex);
            await session.DisposeAsync();
            throw new InvalidOperationException(session.log.Explain(ex), ex);
        }
    }

    private async Task InitializeAsync(CancellationToken parentClosed)
    {
        await lifecycle.WaitAsync(parentClosed);
        try
        {
            if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041))
                throw new PlatformNotSupportedException("无鼠标录制需要 Windows 10 2004 或更新版本。");
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(parentClosed, cancellation.Token);
            MicrophoneCatalog.ValidateSelection(options);
            SaveRecoveryManifest();
            try
            {
                inputActivity = new InputActivityRecorder(directory, clock, options, selection, log, Warn);
                inputActivity.Start(linked.Token);
            }
            catch (OperationCanceledException) when (linked.IsCancellationRequested) { throw; }
            catch (Exception) { Warn("输入活动采集不可用，视频仍可正常录制。"); }
            cursor = new CursorRecorder(directory, clock, selection, Fail, log, Warn,
                inputActivity is null ? null : inputActivity.ObserveClick);
            cursor.SetExcludedWindows(options.ExcludeWindowHandles);
            audio = new AudioCaptureGroup(directory, clock, log, Warn);
            video = new VideoCapture(directory, selection, options, clock, log, Warn, Fail);
            cursor.Start(linked.Token);
            await audio.StartAsync(options, linked.Token);
            await video.StartAsync(linked.Token);
            if (failure is not null) throw failure;
            SaveRecoveryManifest();
            status = "recording";
            log.Write("session-recording", new { StartedAtUnixMs, warnings = Warnings });
            Protocol.State(status, startedAtUnixMs: StartedAtUnixMs, warnings: Warnings);
        }
        finally { lifecycle.Release(); }
    }

    private void SaveRecoveryManifest()
    {
        var temporary = Path.Combine(directory, "recording.recovery.tmp");
        File.WriteAllText(temporary, JsonSerializer.Serialize(new
        {
            options, width = selection.Width, height = selection.Height, clockOrigin = video?.Origin ?? -1,
            startedAtUnixMs = video?.Origin >= 0 ? StartedAtUnixMs : (double?)null,
            createdAt = DateTimeOffset.UtcNow, warnings = Warnings,
            note = "Recovery audio, cursor and input activity use the common QPC clock."
        }, Protocol.Json));
        File.Move(temporary, Path.Combine(directory, "recording.recovery.json"), true);
    }

    private void Warn(string warning)
    {
        warnings.Enqueue(warning);
        log.Write("session-warning", new { warning });
        if (status != "stopped") Protocol.State(status, startedAtUnixMs: video?.Origin >= 0 ? StartedAtUnixMs : null, warning: warning);
    }

    private void Fail(Exception error)
    {
        if (Interlocked.CompareExchange(ref failure, error, null) is not null) return;
        log.Write("session-failed", error: error);
        cancellation.Cancel();
        _ = Task.Run(async () =>
        {
            try { await StopAsync(); }
            catch (Exception ex) { log.Write("failed-session-finalize", error: ex); }
            // Emit fatal state only after flushing recoverable media, never before cleanup.
            Protocol.State("error", log.Explain(error));
        });
    }

    internal Task<NativeRecordingResult> StopAsync()
    {
        lock (stopGate) return stopping ??= StopCoreAsync();
    }

    internal async Task<AudioMuteState> SetAudioMuteAsync(AudioMuteOptions options)
    {
        await lifecycle.WaitAsync();
        try
        {
            if (status != "recording" || audio is null)
                throw new InvalidOperationException("只有正在录制时可以更改静音状态。");
            return audio.SetMute(options);
        }
        finally { lifecycle.Release(); }
    }
    internal async Task SetExcludedApplicationsAsync(string[] applications, CancellationToken token)
    {
        await lifecycle.WaitAsync(token);
        try
        {
            if (status != "recording" || video is null) throw new InvalidOperationException("只有正在录制时可以调整排除应用。");
            var next = LiveWindowExclusions.ForRecording(options with {
                ExcludedApplications = LiveWindowExclusions.NormalizeApplications(applications),
                ExcludeWindowHandles = DemoExclusions(demoVisible)
            });
            video.SetExcludedWindows(next.ExcludeWindowHandles);
            inputActivity?.SetExcludedWindows(next.ExcludeWindowHandles);
            cursor?.SetExcludedWindows(next.ExcludeWindowHandles);
            options = next;
            log.Write("recording-exclusions-updated", new { applications = applications.Length, continuousEncoder = true });
        }
        finally { lifecycle.Release(); }
    }

    private string[]? DemoExclusions(bool visible) => visible ? [] : ownExcludedHandles;

    internal async Task<double> SetDemoVisibleAsync(bool visible, CancellationToken token)
    {
        await lifecycle.WaitAsync(token);
        try
        {
            if (status != "recording" || video is null || !options.SourceId.StartsWith("screen:"))
                throw new InvalidOperationException("演示模式请使用正在录制的屏幕或区域。");
            // Demo includes every visible app window; normal capture restores its exclusions.
            var next = LiveWindowExclusions.ForRecording(options with { ExcludeWindowHandles = DemoExclusions(visible) });
            video.SetExcludedWindows(next.ExcludeWindowHandles);
            inputActivity?.SetExcludedWindows(next.ExcludeWindowHandles);
            cursor?.SetExcludedWindows(next.ExcludeWindowHandles);
            options = next; demoVisible = visible;
            return Math.Max(0, clock.Seconds - video.Origin);
        }
        finally { lifecycle.Release(); }
    }

    internal async Task SetWhiteboardPresentationAsync(WhiteboardPresentationOptions options, CancellationToken token)
    {
        await lifecycle.WaitAsync(token);
        try
        {
            if (status != "recording" || video is null || video.Origin < 0)
                throw new InvalidOperationException("请在录制开始后切换白板模式。");
            whiteboard ??= new WhiteboardCapture(directory, clock, log, Warn, Fail);
            await whiteboard.ApplyAsync(options, video.Origin, token);
        }
        finally { lifecycle.Release(); }
    }

    private async Task<NativeRecordingResult> StopCoreAsync()
    {
        await lifecycle.WaitAsync();
        try
        {
            status = "stopping";
            var stopRequestedAt = clock.Seconds;
            log.Write("session-stopping", new
            {
                frames = video?.Frames ?? 0, stopRequestedAt, lastFrameAt = video?.LastFrameAt ?? -1,
                elapsed = stopRequestedAt - (video?.Origin ?? 0)
            });
            var jobs = new List<Task>();
            if (video is not null) jobs.Add(video.StopAsync());
            if (whiteboard is not null) jobs.Add(whiteboard.StopAsync());
            if (audio is not null) jobs.Add(audio.StopAsync());
            if (cursor is not null) jobs.Add(cursor.StopAsync());
            if (inputActivity is not null) jobs.Add(inputActivity.StopAsync());
            try { await Task.WhenAll(jobs); }
            finally
            {
                try { cursor?.Dispose(); } catch (Exception ex) { log.Write("cursor-dispose-warning", error: ex); }
                try
                {
                    if (inputActivity is not null) await inputActivity.StopAsync();
                    inputActivity?.Dispose();
                }
                catch (Exception) { Warn("输入活动数据清理未完成，视频仍会保存。"); }
                audio?.Dispose();
            }
            var origin = video?.Origin ?? -1;
            if (origin < 0) throw failure ?? new InvalidOperationException("未生成有效视频帧，请重新选择来源或使用兼容模式。");
            var videoDuration = Mp4Timing.ReadDuration(Path.Combine(directory, "screen.mp4"));
            var elapsed = stopRequestedAt - origin;
            var tailSeconds = Math.Max(0, stopRequestedAt - (video?.LastFrameAt ?? stopRequestedAt));
            var difference = elapsed - videoDuration;
            // Sparse WGC sources may stop without a final unchanged frame. Hold only that
            // observed tail; missing time before the last delivered frame must remain an error.
            var tailEvidenceValid = video is not null && video.Error is null && failure is null;
            var tailHold = tailEvidenceValid && difference > 0 && difference <= tailSeconds + 1d / options.Fps ? difference : 0;
            var duration = videoDuration + tailHold;
            log.Write("video-timing", new
            {
                rawVideoDuration = videoDuration, presentationDuration = duration, tailHold,
                elapsed, lastFrameAt = video?.LastFrameAt ?? -1, tailSeconds, tailEvidenceValid,
                timingDifference = difference, unresolvedDifference = elapsed - duration
            });
            // Long sessions must not get a larger allowance for missing interior time.
            // A warning also preserves recovery journals for inspection/recovery.
            if (Math.Abs(elapsed - duration) > .2)
                Warn("视频时间轴与采集时钟存在偏差，已保留原始录制，请检查回放同步。" );
            await CursorRecorder.FinalizeAsync(directory, origin, duration);
            string? inputActivityFile = null;
            if (inputActivity is not null)
            {
                try
                {
                    await InputActivityJournal.FinalizeAsync(directory, origin, duration);
                    inputActivityFile = "input-activity.json";
                }
                catch (Exception) { Warn("输入活动数据未能完整保存，已保留恢复文件，视频仍可使用。"); }
            }
            var systemAudio = audio?.FinalizeTrack("system", origin, duration);
            var microphone = audio?.FinalizeTrack("microphone", origin, duration);
            if (failure is not null) warnings.Enqueue("录制提前结束，已保留可以恢复的视频。" + failure.Message);
            else if (video?.Error is { } videoError) Warn("视频结束时出现异常，已保留可以读取的内容。" + videoError.Message);
            var result = new NativeRecordingResult(directory, duration, selection.Width, selection.Height,
                "screen.mp4", "cursor.json", systemAudio, microphone, StartedAtUnixMs, Warnings, videoDuration, tailHold,
                inputActivityFile);
            var temporary = Path.Combine(directory, "recording.tmp");
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(result, Protocol.Json));
            File.Move(temporary, Path.Combine(directory, "recording.json"), true);
            log.Write("session-saved", new { result.Duration, result.Width, result.Height, result.SystemAudio, result.Microphone, warnings = Warnings });
            CleanupJournals(systemAudio is not null, microphone is not null);
            status = "stopped";
            return result;
        }
        catch (Exception ex) { log.Write("session-save-failed", error: ex); throw new InvalidOperationException(log.Explain(ex), ex); }
        finally { lifecycle.Release(); }
    }

    private void CleanupJournals(bool systemAudio, bool microphone)
    {
        if (failure is not null || warnings.Count > 0) return;
        var files = new List<string> { "cursor.recovery.jsonl", "input-activity.recovery.jsonl", "recording.recovery.json" };
        if (systemAudio) files.Add("system.recovery.wav");
        if (microphone) files.Add("microphone.recovery.wav");
        foreach (var file in files)
        {
            try { File.Delete(Path.Combine(directory, file)); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { log.Write("journal-cleanup-deferred", new { file }, ex); }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        try { await StopAsync(); }
        catch (Exception ex) { Console.Error.WriteLine(ex.Message); }
    }
}
