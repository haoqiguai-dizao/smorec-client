using System.Globalization;
using System.Text.Json;
using ScreenRecorderLib;

namespace FrameFlow.Capture;

// The dedicated helper owns one WGC window source and its fixed project sidecars.
internal sealed class WhiteboardVideoSession
{
    private readonly string directory;
    private readonly CaptureClock clock = new();
    private readonly SessionDiagnostics log;
    private readonly Action<string> warning;
    private readonly Action<Exception> failed;
    private VideoCapture? video;

    internal WhiteboardVideoSession(string directory, Action<string> warning, Action<Exception> failed)
    {
        this.directory = directory; this.warning = warning; this.failed = failed;
        log = new SessionDiagnostics(directory, "whiteboard-capture.log");
    }

    internal async Task StartAsync(string windowId, double screenOriginQpcSeconds)
    {
        var handle = ValidateWindow(windowId);
        var bounds = Win32.WindowBounds(handle);
        if (bounds.Width < 2 || bounds.Height < 2 || Win32.IsIconic(handle))
            throw new ArgumentException("白板窗口尚未就绪，请重新打开白板。");
        var size = CaptureSpecification.Resolve(bounds.Width, bounds.Height, "native", "2560");
        var source = new WindowRecordingSource(handle)
        {
            IsCursorCaptureEnabled = true, OutputSize = new ScreenSize(size.Width, size.Height), Stretch = StretchMode.Fill
        };
        var selection = new SourceSelection(source, () => Win32.WindowBounds(handle), null, size.Width, size.Height);
        var options = new RecordingOptions("whiteboard:" + windowId, false, false, 30, null);
        video = new VideoCapture(directory, selection, options, clock, log, warning, failed, whiteboard: true);
        await video.StartAsync(CancellationToken.None);
        var start = Math.Max(0, clock.ToQpcSeconds(video.Origin) - screenOriginQpcSeconds);
        var offset = -start;
        // Stretch.Fill records a complete fixed-size frame; layout restores window proportions.
        await File.WriteAllTextAsync(Path.Combine(directory, "whiteboard-frames.jsonl"),
            JsonSerializer.Serialize(new { t = start, bounds = new { x = 0, y = 0, width = 1, height = 1 } }, Protocol.Json) + "\n");
        var temporary = Path.Combine(directory, "whiteboard-video.tmp");
        await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(new { offset }, Protocol.Json));
        File.Move(temporary, Path.Combine(directory, "whiteboard-video.json"), true);
        log.Write("whiteboard-ready", new { offset, size.Width, size.Height });
    }

    internal static nint ValidateWindow(string value)
    {
        if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var handle) || handle <= 0
            || !Win32.IsWindow((nint)handle)
            || !uint.TryParse(Environment.GetEnvironmentVariable("FRAMEFLOW_PARENT_PID"), out var parent) || parent == 0)
            throw new ArgumentException("白板采集窗口无效。");
        Win32.GetWindowThreadProcessId((nint)handle, out var owner);
        if (owner != parent) throw new ArgumentException("只能采集本应用持有的白板窗口。");
        return (nint)handle;
    }

    internal async Task StopAsync()
    {
        if (video is null) return;
        await video.StopAsync();
        if (video.Error is { } error) throw error;
    }
}
