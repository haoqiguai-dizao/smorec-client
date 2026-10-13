using ScreenRecorderLib;

namespace FrameFlow.Capture;

internal sealed class VideoCapture
{
    private sealed class Attempt
    {
        internal Recorder? Recorder;
        internal readonly TaskCompletionSource FirstFrame = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal readonly TaskCompletionSource Completed = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal Exception? Error;
        internal int Frames;
        internal double Origin = -1;
        internal double LastFrameAt = -1;
        internal double LastCallbackAt = -1;
        internal double FirstFrameReadyAt = -1;
        internal bool Running;
        internal bool Stopping;
        internal bool Requested;
    }
    private readonly string directory;
    private readonly SourceSelection selection;
    private readonly RecordingOptions options;
    private readonly CaptureClock clock;
    private readonly SessionDiagnostics log;
    private readonly Action<string> warning;
    private readonly Action<Exception> failed;
    private readonly bool whiteboard;
    private string Stem => whiteboard ? "whiteboard-capture" : "screen";
    private readonly bool fragmentedMp4 = Environment.GetEnvironmentVariable("FRAMEFLOW_CAPTURE_FRAGMENTED_MP4") != "0";
    private Attempt? active;
    private nint[]? excludedWindows;
    internal double Origin => active?.Origin ?? -1;
    internal int Frames => active?.Frames ?? 0;
    internal double LastFrameAt => active?.LastFrameAt ?? -1;
    internal Exception? Error => active?.Error;

    internal VideoCapture(string directory, SourceSelection selection, RecordingOptions options, CaptureClock clock,
        SessionDiagnostics log, Action<string> warning, Action<Exception> failed, bool whiteboard = false)
    {
        this.directory = directory; this.selection = selection; this.options = options;
        this.clock = clock; this.log = log; this.warning = warning; this.failed = failed;
        this.whiteboard = whiteboard;
    }

    internal async Task StartAsync(CancellationToken cancellation)
    {
        // Prefer the validated hardware path to leave CPU time for desktop interaction.
        // The explicit software override is retained for compatibility diagnostics.
        var hardwareRequested = Environment.GetEnvironmentVariable("FRAMEFLOW_CAPTURE_ENCODER") != "software";
        var modes = hardwareRequested ? new[] { true, false } : new[] { false };
        foreach (var hardware in modes)
        {
            cancellation.ThrowIfCancellationRequested();
            var attempt = new Attempt();
            active = attempt;
            try
            {
                var timeout = TimeSpan.FromSeconds(hardware ? 10 : 20);
                var bounds = selection.Bounds();
                log.Write("video-start", new { hardware, fragmentedMp4, fixedFramerate = false, options.Fps, options.Resolution,
                    sourceWidth = bounds.Width, sourceHeight = bounds.Height, selection.Crop,
                    selection.Width, selection.Height, diagnosticMaxEdge = Environment.GetEnvironmentVariable("FRAMEFLOW_CAPTURE_MAX_EDGE"),
                    timeoutSeconds = timeout.TotalSeconds });
                attempt.Recorder = Recorder.CreateRecorder(CreateOptions(hardware));
                attempt.Recorder.OnStatusChanged += (_, args) =>
                {
                    var at = clock.Seconds;
                    if (args.Status == RecorderStatus.Recording && attempt.FirstFrameReadyAt < 0)
                        attempt.FirstFrameReadyAt = at;
                    log.Write("video-status", new { status = args.Status.ToString(), at, unixMs = clock.ToUnixMilliseconds(at) });
                };
                attempt.Recorder.OnFrameRecorded += (_, _) => ObserveRecordedFrame(attempt, hardware);
                attempt.Recorder.OnRecordingComplete += (_, _) => attempt.Completed.TrySetResult();
                attempt.Recorder.OnRecordingFailed += (_, args) =>
                {
                    var error = new InvalidOperationException("Windows 视频采集失败：" + args.Error);
                    lock (attempt)
                    {
                        attempt.Error = error;
                        attempt.FirstFrame.TrySetException(error);
                        attempt.Completed.TrySetResult();
                        log.Write("video-failed", new { hardware, attempt.Frames }, error);
                        if (attempt.Running && !attempt.Stopping) failed(error);
                    }
                };
                attempt.Requested = true;
                attempt.Recorder.Record(Path.Combine(directory, Stem + ".mp4"));
                await attempt.FirstFrame.Task.WaitAsync(timeout, cancellation);
                lock (attempt)
                {
                    if (attempt.Error is not null) throw attempt.Error;
                    attempt.Running = true;
                }
                return;
            }
            catch (Exception ex)
            {
                log.Write("video-start-attempt-failed", new { hardware, attempt.Frames }, ex);
                await CloseAttemptAsync(attempt);
                if (cancellation.IsCancellationRequested) throw new OperationCanceledException(cancellation);
                if (!hardware) throw new InvalidOperationException($"未能开始 {selection.Width}×{selection.Height} / {options.Fps} FPS 录制，请检查录制来源或选择较低规格。" + ex.Message, ex);
                var file = Path.Combine(directory, Stem + ".mp4");
                if (File.Exists(file)) File.Move(file, Path.Combine(directory, Stem + ".hardware-attempt.mp4"), true);
                warning("硬件录制未能启动，已切换软件兼容模式。");
            }
        }
    }

    private void ObserveRecordedFrame(Attempt attempt, bool hardware)
    {
        attempt.LastCallbackAt = clock.Seconds;
        var first = Interlocked.Increment(ref attempt.Frames) == 1;
        try
        {
            // A static first frame can take a full second to be delivered. Its callback time
            // is not the media origin; use the encoder's presentation-clock correlation.
            var recorder = attempt.Recorder!;
            var originQpc100ns = first ? recorder.GetMediaClockOriginQpc100ns() : -1;
            if (first) attempt.Origin = clock.VideoOrigin(originQpc100ns, clock.Seconds);
            // Read during the synchronous frame callback, before the next capture iteration.
            // Encoding wait time must not be mistaken for the end of the recorded image.
            var mediaEnd100ns = recorder.GetCurrentVideoFrameEnd100ns();
            attempt.LastFrameAt = VideoClockCorrelation.FrameEnd(attempt.Origin, mediaEnd100ns,
                clock.Seconds, attempt.LastFrameAt);
            if (first)
            {
                log.Write("video-first-frame", new
                {
                    hardware, origin = attempt.Origin, originQpc100ns, mediaEnd100ns,
                    originSource = "presentation-clock-correlation",
                    startedAtUnixMs = clock.ToUnixMilliseconds(attempt.Origin),
                    firstFrameReadyAt = attempt.FirstFrameReadyAt,
                    firstFrameReadyAtUnixMs = clock.ToUnixMilliseconds(attempt.FirstFrameReadyAt)
                });
                attempt.FirstFrame.TrySetResult();
            }
        }
        catch (Exception ex)
        {
            lock (attempt) attempt.Error = ex;
            log.Write("video-clock-failed", new { hardware, first }, ex);
            attempt.FirstFrame.TrySetException(ex);
            if (attempt.Running && !attempt.Stopping) failed(ex);
        }
    }

    private RecorderOptions CreateOptions(bool hardware) => new()
    {
        SourceOptions = new SourceOptions { RecordingSources = [selection.Source] },
        OutputOptions = new OutputOptions
        {
            RecorderMode = RecorderMode.Video, OutputFrameSize = new ScreenSize(selection.Width, selection.Height), Stretch = StretchMode.Fill
        },
        AudioOptions = new AudioOptions { IsAudioEnabled = false },
        MouseOptions = new MouseOptions { IsMousePointerEnabled = whiteboard, IsMouseClicksDetected = false },
        VideoEncoderOptions = new VideoEncoderOptions
        {
            // Keep source timing when frames are sparse. RecordingSession explicitly accounts
            // for a verified unchanged tail without altering encoded frame timestamps.
            Framerate = options.Fps, IsFixedFramerate = false, Quality = 85,
            Bitrate = (int)Math.Clamp(selection.Width * (long)selection.Height * options.Fps / 8, 8_000_000L, 40_000_000L),
            IsHardwareEncodingEnabled = hardware, IsLowLatencyEnabled = true,
            IsFragmentedMp4Enabled = fragmentedMp4, IsMp4FastStartEnabled = false
        },
        LogOptions = new LogOptions
        {
            IsLogEnabled = true,
            LogSeverityLevel = options.ExcludeWindowHandles is { Length: > 0 } ? LogLevel.Info : LogLevel.Warn,
            LogFilePath = Path.Combine(directory, (whiteboard ? "whiteboard-" : "") + (hardware ? "encoder-hardware.log" : "encoder-software.log"))
        }
    };

    internal Task StopAsync() => active is null ? Task.CompletedTask : CloseAttemptAsync(active);
    internal void SetExcludedWindows(string[]? handles)
    {
        if (selection.Source is not DisplayRecordingSource display) return;
        var recorder = active?.Recorder ?? throw new InvalidOperationException("录制已结束。");
        var next = CaptureExclusions.ForDisplay(handles);
        var previous = excludedWindows ?? display.ExcludedWindowHandles;
        try { recorder.UpdateSessionWindowExclusions(display.ID, next); excludedWindows = next; }
        catch (Exception error)
        {
            try { recorder.UpdateSessionWindowExclusions(display.ID, previous); }
            catch (Exception restoreError)
            {
                var failure = new AggregateException("排除应用更新与恢复失败，录制将保存已有内容。", error, restoreError);
                failed(failure); throw failure;
            }
            throw new InvalidOperationException("排除应用更新失败，已恢复原来的选择。", error);
        }
    }

    private async Task CloseAttemptAsync(Attempt attempt)
    {
        lock (attempt) attempt.Stopping = true;
        var recorder = attempt.Recorder;
        if (recorder is null) return;
        try
        {
            if (attempt.Requested)
            {
                recorder.Stop();
                await attempt.Completed.Task.WaitAsync(TimeSpan.FromSeconds(attempt.Running ? 15 : 5));
            }
        }
        catch (Exception ex) { attempt.Error ??= ex; log.Write("video-stop-warning", new { attempt.Frames }, ex); }
        finally
        {
            try { recorder.Dispose(); }
            catch (Exception ex) { log.Write("video-dispose-warning", error: ex); }
            attempt.Recorder = null;
            log.Write("video-closed", new
            {
                attempt.Frames, attempt.Origin, attempt.LastFrameAt, attempt.LastCallbackAt,
                lastFrameSource = "submitted-sample-end",
                lastFrameAtUnixMs = attempt.LastFrameAt >= 0 ? clock.ToUnixMilliseconds(attempt.LastFrameAt) : (double?)null,
                elapsed = attempt.LastFrameAt - attempt.Origin
            });
        }
    }
}
