using System.Diagnostics;

namespace FrameFlow.Capture;

internal sealed class CaptureClock
{
    private readonly long start = Stopwatch.GetTimestamp();
    private readonly double startedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    internal double Seconds => (Stopwatch.GetTimestamp() - start) / (double)Stopwatch.Frequency;
    internal double ToUnixMilliseconds(double seconds) => startedAtUnixMs + seconds * 1000;
    // QPC is shared across processes; separate window encoders use the same media origin.
    internal double ToQpcSeconds(double seconds) => start / (double)Stopwatch.Frequency + seconds;
    internal double VideoOrigin(long originQpc100ns, double observedAt) =>
        VideoClockCorrelation.Resolve(originQpc100ns, start, Stopwatch.Frequency, observedAt);
    // IAudioCaptureClient timestamps are QPC converted to 100 ns units, not DateTime ticks.
    internal double FromAudioTimestamp(long qpc) => qpc / 10_000_000d - start / (double)Stopwatch.Frequency;
}
