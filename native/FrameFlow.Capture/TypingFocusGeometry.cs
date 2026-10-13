namespace FrameFlow.Capture;

internal static class TypingFocusGeometry
{
    internal static bool Valid(InputActivityFocus point) => double.IsFinite(point.X) && double.IsFinite(point.Y)
        && point.X is >= 0 and <= 1 && point.Y is >= 0 and <= 1;

    internal static InputActivityFocus? Normalize(double x, double y, Win32.Rect bounds, CaptureRect? crop)
    {
        var width = crop?.Width ?? bounds.Width;
        var height = crop?.Height ?? bounds.Height;
        if (bounds.Width <= 0 || bounds.Height <= 0 || width <= 0 || height <= 0) return null;
        var point = new InputActivityFocus((x - bounds.Left - (crop?.X ?? 0)) / width,
            (y - bounds.Top - (crop?.Y ?? 0)) / height);
        return Valid(point) ? point : null;
    }

    internal static InputActivityFocus? EditorCenter(double[] rect, Win32.Rect bounds, CaptureRect? crop)
    {
        if (rect.Length != 4 || rect.Any(value => !double.IsFinite(value)) || rect[2] < 2 || rect[3] < 2) return null;
        var width = crop?.Width ?? bounds.Width;
        var height = crop?.Height ?? bounds.Height;
        // A whole document rectangle is not evidence of a precise typing location.
        if (rect[2] > width * .85 || rect[3] > height * .5) return null;
        return Normalize(rect[0] + rect[2] / 2, rect[1] + rect[3] / 2, bounds, crop);
    }
}
