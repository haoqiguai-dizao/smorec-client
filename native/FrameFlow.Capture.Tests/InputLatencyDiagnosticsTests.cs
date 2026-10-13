using FrameFlow.Capture;

internal static class InputLatencyDiagnosticsTests
{
    internal static void Run(Action<bool, string> check)
    {
        check(InputLatencyDiagnostics.EventAgeMilliseconds(1250, 1200) == 50,
            "input age uses event time and callback entry ticks");
        check(InputLatencyDiagnostics.EventAgeMilliseconds(7, uint.MaxValue - 3) == 11,
            "input age survives DWORD tick rollover");
        check(InputLatencyDiagnostics.EventAgeMilliseconds(100, 101) is null,
            "future event timestamp does not become a multi-day latency");
        var empty = new LatencyDistribution().Snapshot();
        check(empty.Count == 0 && empty.MeanMs is null && empty.MaximumMs is null
            && empty.P95UpperBoundMs is null && empty.BucketCounts.All(count => count == 0),
            "empty latency metrics report unavailable rather than false zero latency");
        var distribution = new LatencyDistribution();
        foreach (var delay in new long[] { 0, 100, 101, 250, 1000, 1_500_000 }) distribution.Observe(delay);
        var sample = distribution.Snapshot();
        check(sample.Count == 6 && sample.BucketCounts.Sum() == 6 && sample.BucketCounts[0] == 2
            && sample.BucketCounts[1] == 2 && sample.BucketCounts[3] == 1 && sample.BucketCounts[^1] == 1,
            "latency histogram retains exact boundaries and overflow events");
        check(sample.MaximumMs == 1500 && sample.P50UpperBoundMs == .25 && sample.P95UpperBoundMs == 1500
            && Math.Abs(sample.MeanMs!.Value - 250.241833333333) < .000001,
            "latency quantiles use bucket upper bounds and retain an overflow maximum");
        var diagnostic = new InputLatencyDiagnostics(1_000_000);
        diagnostic.Record(7, uint.MaxValue - 3, 1_000_000, 1_000_500, 1_004_500);
        diagnostic.Record(100, 101, 2_000_000, 2_000_100, 2_000_600);
        var result = diagnostic.Snapshot();
        check(result.Events == 2 && result.InvalidEventTimes == 1 && result.EventArrival.Count == 1
            && result.EventArrival.MaximumMs == 11, "invalid arrival timestamps do not discard callback timing");
        check(result.OwnCallback.MaximumMs == .5 && result.NextHookChain.MaximumMs == 4
            && result.OwnCallback.Count == 2 && result.NextHookChain.Count == 2,
            "callback work and downstream hook time remain separate distributions");
        var concurrent = new LatencyDistribution();
        Parallel.For(0, 4000, index => concurrent.Observe(index % 2 == 0 ? 100 : 500));
        var concurrentResult = concurrent.Snapshot();
        check(concurrentResult.Count == 4000 && concurrentResult.BucketCounts.Sum() == 4000
            && concurrentResult.MeanMs == .3 && concurrentResult.MaximumMs == .5,
            "latency aggregation retains concurrent updates without callback locks");
    }
}
