using FrameFlow.Capture;

internal static class VideoClockCorrelationTests
{
    internal static void Run(Action<bool, string> check)
    {
        const long start = 8_000_000_000;
        const long origin = 8_006_000_000;
        var first = VideoClockCorrelation.Resolve(origin, start, 10_000_000, .62);
        var staticFirst = VideoClockCorrelation.Resolve(origin, start, 10_000_000, 1.62);
        check(Math.Abs(first - .6) < .000001 && first == staticFirst,
            "static first-frame delay cannot move the recording origin or audio alignment");
        check(Math.Abs(VideoClockCorrelation.Resolve(origin, start * 3, 30_000_000, 1.62) - .6) < .000001,
            "QPC correlation converts independent Stopwatch frequencies");
        var encodedEnd = VideoClockCorrelation.FrameEnd(.6, 106_084_005, 11.2627456, 10);
        check(Math.Abs(encodedEnd - 11.2084005) < .000001,
            "encoding wait time cannot shorten the observed static tail");
        check(encodedEnd == VideoClockCorrelation.FrameEnd(.6, 106_084_005, 12.5, 10),
            "late callback leaves the exact submitted sample end unchanged");
        foreach (var invalid in new long[] { -1, 0, start - 1, origin + 30_000_000 })
        {
            var rejected = false;
            try { VideoClockCorrelation.Resolve(invalid, start, 10_000_000, 1.62); }
            catch (InvalidOperationException) { rejected = true; }
            check(rejected, $"invalid media origin {invalid} cannot silently use a callback estimate");
        }
    }
}
