using System.Runtime.InteropServices;
using ScreenRecorderLib;

namespace FrameFlow.Capture;

internal record SourceSelection(RecordingSourceBase Source, Func<Win32.Rect> Bounds, CaptureRect? Crop, int Width, int Height);

internal static class SourceCatalog
{
    private static Dictionary<string, Win32.Rect> Monitors()
    {
        var result = new Dictionary<string, Win32.Rect>(StringComparer.OrdinalIgnoreCase);
        Win32.EnumDisplayMonitors(0, 0, (nint monitor, nint _, ref Win32.Rect rect, nint _) =>
        {
            var info = new Win32.MonitorInfo { Size = Marshal.SizeOf<Win32.MonitorInfo>(), Device = "" };
            if (Win32.GetMonitorInfo(monitor, ref info)) result[info.Device] = info.Monitor;
            return true;
        }, 0);
        return result;
    }

    internal static CaptureSource[] List()
    {
        var sources = Monitors().Select((pair, index) => new CaptureSource(
            "screen:" + pair.Key, "screen", $"显示器 {index + 1} · {pair.Value.Width} × {pair.Value.Height}",
            pair.Value.Width, pair.Value.Height, ToCaptureRect(pair.Value))).ToList();
        foreach (var window in Recorder.GetWindows())
        {
            if (IsOwnWindow(window.Handle)) continue;
            var bounds = Win32.WindowBounds(window.Handle);
            if (bounds.Width < 64 || bounds.Height < 64 || string.IsNullOrWhiteSpace(window.Title)) continue;
            sources.Add(new CaptureSource($"window:{window.Handle.ToInt64()}", "window", window.Title,
                bounds.Width, bounds.Height, ToCaptureRect(bounds)));
        }
        return sources.ToArray();
    }

    private static CaptureRect ToCaptureRect(Win32.Rect bounds) =>
        new(bounds.Left, bounds.Top, bounds.Width, bounds.Height);

    private static bool IsOwnWindow(nint window)
    {
        Win32.GetWindowThreadProcessId(window, out var pid);
        _ = uint.TryParse(Environment.GetEnvironmentVariable("FRAMEFLOW_PARENT_PID"), out var parentPid);
        return pid == Environment.ProcessId || (parentPid != 0 && pid == parentPid);
    }

    internal static SourceSelection Select(RecordingOptions options)
    {
        if (options.Fps is not (30 or 60)) throw new ArgumentException("录制帧率必须为 30 或 60。");
        RecordingSourceBase source;
        Func<Win32.Rect> getBounds;
        if (options.SourceId.StartsWith("screen:", StringComparison.Ordinal))
        {
            var device = options.SourceId[7..];
            if (!Monitors().TryGetValue(device, out var display)) throw new ArgumentException("显示器已断开，请重新选择。");
            source = new DisplayRecordingSource(device)
            {
                RecorderApi = RecorderApi.WindowsGraphicsCapture, IsCursorCaptureEnabled = false,
                ExcludedWindowHandles = CaptureExclusions.ForDisplay(options.ExcludeWindowHandles)
            };
            getBounds = () => display;
        }
        else if (options.SourceId.StartsWith("window:", StringComparison.Ordinal) && long.TryParse(options.SourceId[7..], out var handle))
        {
            if (IsOwnWindow((nint)handle)) throw new ArgumentException("不能录制 FrameFlow 自身窗口。");
            source = new WindowRecordingSource((nint)handle) { IsCursorCaptureEnabled = false };
            getBounds = () => Win32.WindowBounds((nint)handle);
        }
        else throw new ArgumentException("无效的录制来源。");

        var bounds = getBounds();
        if (bounds.Width < 2 || bounds.Height < 2) throw new ArgumentException("录制窗口已关闭或最小化。");
        var crop = options.Crop;
        if (crop is not null)
        {
            if (!double.IsFinite(crop.X + crop.Y + crop.Width + crop.Height) || crop.X < 0 || crop.Y < 0 ||
                crop.Width < 2 || crop.Height < 2 || crop.X + crop.Width > bounds.Width || crop.Y + crop.Height > bounds.Height)
                throw new ArgumentException("选区必须位于录制来源内部，尺寸不能小于 2 像素。");
            crop = new CaptureRect(Math.Floor(crop.X), Math.Floor(crop.Y), Math.Floor(crop.Width / 2) * 2, Math.Floor(crop.Height / 2) * 2);
            source.SourceRect = new ScreenRect(crop.X, crop.Y, crop.Width, crop.Height);
        }
        var size = CaptureSpecification.Resolve((int)(crop?.Width ?? bounds.Width), (int)(crop?.Height ?? bounds.Height),
            options.Resolution, Environment.GetEnvironmentVariable("FRAMEFLOW_CAPTURE_MAX_EDGE"));
        var width = size.Width;
        var height = size.Height;
        source.OutputSize = new ScreenSize(width, height);
        source.Stretch = StretchMode.Fill;
        return new SourceSelection(source, getBounds, crop, width, height);
    }
}
