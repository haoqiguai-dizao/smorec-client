using System.Globalization;

namespace FrameFlow.Capture;

internal readonly record struct CaptureDimensions(int Width, int Height);

internal static class CaptureSpecification
{
    internal const int MaximumSourceEdge = 16384;
    internal const int MaximumOutputEdge = 8192;
    internal const long MaximumOutputPixels = 33_177_600;

    internal static CaptureDimensions Resolve(int width, int height, string resolution, string? diagnosticMaxEdge = null)
    {
        if (width is < 2 or > MaximumSourceEdge || height is < 2 or > MaximumSourceEdge)
            throw new ArgumentException($"录制来源尺寸必须在 2–{MaximumSourceEdge} 像素之间。");
        // Align the source first, matching the launcher/export specification calculation.
        width = width / 2 * 2;
        height = height / 2 * 2;
        var maximum = resolution switch
        {
            "native" => (int?)null,
            "2160p" => 3840,
            "1440p" => 2560,
            "1080p" => 1920,
            _ => throw new ArgumentException("未知录制分辨率，请重新选择原始分辨率、4K、2K 或 1080p。")
        };
        if (diagnosticMaxEdge is not null)
        {
            if (!int.TryParse(diagnosticMaxEdge, NumberStyles.None, CultureInfo.InvariantCulture, out var diagnostic)
                || diagnostic is < 640 or > MaximumOutputEdge)
                throw new ArgumentException($"FRAMEFLOW_CAPTURE_MAX_EDGE 必须为 640–{MaximumOutputEdge} 的整数。");
            maximum = diagnostic;
        }
        var scale = maximum is { } limit ? Math.Min(1, limit / (double)Math.Max(width, height)) : 1;
        var output = new CaptureDimensions((int)(width * scale) / 2 * 2, (int)(height * scale) / 2 * 2);
        if (output.Width < 2 || output.Height < 2)
            throw new ArgumentException("当前选区比例无法生成有效视频，请扩大选区或选择原始分辨率。");
        if (output.Width > MaximumOutputEdge || output.Height > MaximumOutputEdge)
            throw new ArgumentException($"原始分辨率超过 {MaximumOutputEdge} 像素，请选择较低录制分辨率或缩小选区。");
        if ((long)output.Width * output.Height > MaximumOutputPixels)
            throw new ArgumentException("录制画面超过 8K UHD 像素总量，请选择较低录制分辨率或缩小选区。");
        return output;
    }
}
