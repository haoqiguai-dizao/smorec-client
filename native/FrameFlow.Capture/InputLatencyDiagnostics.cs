using System.Diagnostics;

namespace FrameFlow.Capture;

internal sealed class InputLatencyDiagnostics
{
    private readonly long frequency;
    private readonly LatencyDistribution arrival = new();
    private readonly LatencyDistribution ownWork = new();
    private readonly LatencyDistribution nextHook = new();
    private long events;
    private long invalidEventTimes;

    internal InputLatencyDiagnostics(long? timestampFrequency = null)
    {
        frequency = timestampFrequency ?? Stopwatch.Frequency;
        if (frequency <= 0) throw new ArgumentOutOfRangeException(nameof(timestampFrequency));
    }

    internal static uint? EventAgeMilliseconds(uint now, uint eventTime)
    {
        // Both clocks are DWORD millisecond ticks. Subtraction must survive the 49.7-day wrap.
        var age = unchecked(now - eventTime);
        return age <= int.MaxValue ? age : null;
    }

    internal void Record(uint now, uint eventTime, long entered, long chainStarted, long exited)
    {
        Interlocked.Increment(ref events);
        if (EventAgeMilliseconds(now, eventTime) is { } age) arrival.Observe(age * 1000L);
        else Interlocked.Increment(ref invalidEventTimes);
        ownWork.Observe(Microseconds(entered, chainStarted));
        nextHook.Observe(Microseconds(chainStarted, exited));
    }

    private long Microseconds(long start, long end) =>
        (long)Math.Round(Math.Max(0, end - start) * (1_000_000d / frequency));

    internal InputLatencySnapshot Snapshot() => new(
        Interlocked.Read(ref events), Interlocked.Read(ref invalidEventTimes),
        arrival.Snapshot(), ownWork.Snapshot(), nextHook.Snapshot());
}

internal sealed class LatencyDistribution
{
    private static readonly long[] UpperMicroseconds = [100, 250, 500, 1000, 2000, 4000, 8000,
        16_000, 33_000, 66_000, 100_000, 250_000, 500_000, 1_000_000];
    private readonly long[] buckets = new long[UpperMicroseconds.Length + 1];
    private long count;
    private long totalMicroseconds;
    private long maximumMicroseconds;

    internal void Observe(long microseconds)
    {
        microseconds = Math.Max(0, microseconds);
        var bucket = 0;
        while (bucket < UpperMicroseconds.Length && microseconds > UpperMicroseconds[bucket]) bucket++;
        Interlocked.Increment(ref buckets[bucket]);
        Interlocked.Add(ref totalMicroseconds, microseconds);
        var maximum = Interlocked.Read(ref maximumMicroseconds);
        while (microseconds > maximum)
        {
            var prior = Interlocked.CompareExchange(ref maximumMicroseconds, microseconds, maximum);
            if (prior == maximum) break;
            maximum = prior;
        }
        Interlocked.Increment(ref count);
    }

    internal LatencySnapshot Snapshot()
    {
        var observed = Interlocked.Read(ref count);
        var maximum = Interlocked.Read(ref maximumMicroseconds) / 1000d;
        var counts = new long[buckets.Length];
        for (var index = 0; index < counts.Length; index++) counts[index] = Interlocked.Read(ref buckets[index]);
        var bounds = UpperMicroseconds.Select(value => (double?)(value / 1000d)).Append(null).ToArray();
        double? Percentile(double percentile)
        {
            if (observed == 0) return null;
            var target = (long)Math.Ceiling(observed * percentile);
            var accumulated = 0L;
            for (var index = 0; index < counts.Length; index++)
            {
                accumulated += counts[index];
                if (accumulated >= target) return bounds[index] ?? maximum;
            }
            return maximum;
        }
        return new LatencySnapshot(observed, observed == 0 ? null :
            Interlocked.Read(ref totalMicroseconds) / (1000d * observed), observed == 0 ? null : maximum,
            Percentile(.5), Percentile(.95), Percentile(.99), bounds, counts);
    }
}

internal record LatencySnapshot(long Count, double? MeanMs, double? MaximumMs,
    double? P50UpperBoundMs, double? P95UpperBoundMs, double? P99UpperBoundMs,
    double?[] BucketUpperBoundsMs, long[] BucketCounts);

internal record InputLatencySnapshot(long Events, long InvalidEventTimes,
    LatencySnapshot EventArrival, LatencySnapshot OwnCallback, LatencySnapshot NextHookChain);
