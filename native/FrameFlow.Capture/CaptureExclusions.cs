using System.Globalization;
using ScreenRecorderLib;

namespace FrameFlow.Capture;

internal static class CaptureExclusions
{
    internal static nint[] ForDisplay(string[]? handles)
    {
        if (handles is not { Length: > 0 }) return [];
        if (!Recorder.IsSessionWindowExclusionSupported())
            throw new PlatformNotSupportedException("当前 Windows 不支持在屏幕录制中单独排除可见悬浮窗，请改用窗口录制。");
        return handles.Select(value =>
        {
            if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var handle)
                || handle <= 0 || !Win32.IsWindow((nint)handle))
                throw new ArgumentException("录制悬浮窗已关闭，请重新开始录制。");
            return (nint)handle;
        }).Distinct().ToArray();
    }
}
