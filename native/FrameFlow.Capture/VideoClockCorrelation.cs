namespace FrameFlow.Capture;

internal static class VideoClockCorrelation
{
    // Media Foundation returns system QPC in 100 ns units; Stopwatch uses its own frequency.
    internal static double Resolve(long originQpc100ns, long captureStartTicks, long frequency, double observedAt)
    {
        if (originQpc100ns <= 0 || captureStartTicks < 0 || frequency <= 0 || !double.IsFinite(observedAt) || observedAt < 0)
            throw new InvalidOperationException("无法读取屏幕录制的准确时间起点。");
        var origin = originQpc100ns / 10_000_000d - captureStartTicks / (double)frequency;
        if (!double.IsFinite(origin) || origin < 0 || origin > observedAt)
            throw new InvalidOperationException("屏幕录制时钟与系统时钟不一致。");
        return origin;
    }

    internal static double FrameEnd(double origin, long mediaEnd100ns, double callbackAt, double previousEnd)
    {
        var end = origin + mediaEnd100ns / 10_000_000d;
        if (!double.IsFinite(origin) || origin < 0 || mediaEnd100ns <= 0
            || !double.IsFinite(callbackAt) || end > callbackAt || end < previousEnd)
            throw new InvalidOperationException("屏幕录制帧的时间位置无效。");
        return end;
    }
}
