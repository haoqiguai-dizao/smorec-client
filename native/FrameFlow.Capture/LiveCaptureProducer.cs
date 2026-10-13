using ScreenRecorderLib;

namespace FrameFlow.Capture;

internal sealed class LiveCaptureProducer : IAsyncDisposable
{
    private Recorder? recorder;
    private readonly CaptureClock clock;
    private readonly int generation;
    private readonly TaskCompletionSource first = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly LiveFrameServer frames;
    private readonly LiveInputMonitor input;
    private readonly LiveCaptureStartupSignal startup;
    private readonly TaskCompletionSource completed = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly SourceSelection selection;
    private bool disposed;
    private readonly int fps;
    internal string[] ExcludedHandles { get; }
    internal int Width => selection.Width;
    internal int Height => selection.Height;

    private LiveCaptureProducer(RecordingOptions options, LiveFrameServer frames, CaptureClock clock, int generation)
    {
        ExcludedHandles = options.ExcludeWindowHandles ?? []; fps = options.Fps;
        this.frames = frames; this.clock = clock; this.generation = generation;
        selection = SourceCatalog.Select(options with { Resolution = "1080p" });
        startup = new LiveCaptureStartupSignal(error =>
            Protocol.Write(new { @event = "live-error", error = error.Message }));
        input = new LiveInputMonitor(clock, selection, options);
    }

    internal static Task<LiveCaptureProducer> StartAsync(RecordingOptions options, LiveFrameServer frames, CaptureClock clock, int generation, CancellationToken token) =>
        LiveCaptureStartup.RunAsync(options, LiveWindowExclusions.Snapshot(options),
            LiveWindowExclusions.IsCurrent, Win32.IsWindow, merged => new LiveCaptureProducer(merged, frames, clock, generation),
            (session, cancellation) => session.StartCoreAsync(cancellation), token);

    private async Task StartCoreAsync(CancellationToken token)
    {
        var diagnose = Environment.GetEnvironmentVariable("FRAMEFLOW_LIVE_DIAGNOSTICS") == "1";
        recorder = Recorder.CreateRecorder(new RecorderOptions
        {
            SourceOptions = new SourceOptions { RecordingSources = [selection.Source] },
            OutputOptions = new OutputOptions
            {
                RecorderMode = RecorderMode.Preview, OutputFrameSize = new ScreenSize(Width, Height),
                Stretch = StretchMode.Fill, IsVideoFramePreviewEnabled = true,
                VideoFramePreviewSize = new ScreenSize(Width, Height)
            },
            AudioOptions = new AudioOptions { IsAudioEnabled = false },
            MouseOptions = new MouseOptions { IsMousePointerEnabled = false, IsMouseClicksDetected = false },
            VideoEncoderOptions = new VideoEncoderOptions { Framerate = fps, IsFixedFramerate = true },
            LogOptions = new LogOptions { IsLogEnabled = diagnose, LogSeverityLevel = LogLevel.Debug,
                LogFilePath = diagnose ? Environment.GetEnvironmentVariable("FRAMEFLOW_LIVE_LOG_PATH") : null }
        });
        recorder.OnFrameRecorded += (_, frame) =>
        {
            if (diagnose)
            {
                diagnose = false;
                var bitmap = frame.BitmapData;
                Console.Error.WriteLine(System.Text.Json.JsonSerializer.Serialize(new {
                    livePreview = true, expectedWidth = Width, expectedHeight = Height,
                    width = bitmap?.Width, height = bitmap?.Height, stride = bitmap?.Stride, length = bitmap?.Length }));
            }
            if (frames.Publish(frame.BitmapData, generation)) first.TrySetResult();
        };
        recorder.OnRecordingComplete += (_, _) => completed.TrySetResult();
        recorder.OnRecordingFailed += (_, error) =>
        {
            completed.TrySetResult();
            startup.Fail(new LiveCaptureBackendException(error.Error));
        };
        // Preview mode initializes only the capture/clock: no sink writer or media output.
        recorder.Record(Stream.Null);
        await startup.WaitForFrameAsync(first.Task, token);
        input.Start(token);
        startup.Activate();
    }

    public async ValueTask DisposeAsync()
    {
        if (disposed) return;
        disposed = true;
        startup.Close();
        await LiveCaptureStartup.CleanupAsync(input.DisposeAsync, StopRecorderAsync);
    }

    private async ValueTask StopRecorderAsync()
    {
        var active = recorder;
        recorder = null;
        if (active is null) return;
        try
        {
            active.Stop();
            try { await completed.Task.WaitAsync(TimeSpan.FromSeconds(8)); }
            catch (TimeoutException) { }
        }
        finally { active.Dispose(); }
    }
}
