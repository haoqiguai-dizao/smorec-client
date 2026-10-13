#include "VideoSampleMetrics.h"
#include <iostream>
#include <stdexcept>

namespace {
unsigned checks = 0;
void Check(bool value, const char* name) {
    ++checks;
    if (!value) throw std::runtime_error(name);
}
VideoSampleObservation Sample(std::int64_t pts, std::int64_t duration = 100) {
    VideoSampleObservation sample{};
    sample.Enabled = sample.TimingValid = true;
    sample.Pts = pts;
    sample.Duration = duration;
    return sample;
}
void Timing() {
    VideoSampleMetrics metrics;
    Check(metrics.WaitP95UpperUs() == 0, "empty percentile");
    metrics.Observe(Sample(1000), 250);
    metrics.Observe(Sample(1100), 251);
    metrics.Observe(Sample(1200), 500);
    Check(metrics.Attempts == 3 && metrics.Accepted == 3, "accepted count");
    Check(metrics.FirstPts == 1000 && metrics.LastEnd == 1300, "accepted range");
    Check(metrics.DurationSum == 300 && !metrics.Gaps && !metrics.Overlaps, "contiguous durations");
    Check(metrics.WaitBuckets[0] == 1 && metrics.WaitBuckets[1] == 2, "inclusive wait boundaries");
    metrics.Observe(Sample(1500), 0);
    metrics.Observe(Sample(1550), 0);
    metrics.Observe(Sample(1550), 0);
    Check(metrics.Gaps == 1 && metrics.GapTotal == 200, "gap from previous accepted end");
    Check(metrics.Overlaps == 2 && metrics.OverlapTotal == 150, "overlap sum");
    Check(metrics.NonMonotonic == 1, "equal PTS is nonmonotonic");
    metrics.Observe(Sample(1200), 0);
    Check(metrics.NonMonotonic == 2, "backward PTS is nonmonotonic");
}
void Failures() {
    VideoSampleMetrics metrics;
    metrics.Observe(Sample(0), 10);
    auto failed = Sample(100);
    failed.Result = -1;
    metrics.Observe(failed, 20);
    metrics.Observe(Sample(200), 30);
    Check(metrics.Attempts == 3 && metrics.Accepted == 2 && metrics.Failures == 1, "failed write counted");
    Check(metrics.Gaps == 1 && metrics.GapTotal == 100 && metrics.DurationSum == 200, "failed write excluded from accepted range");
    auto invalid = Sample(300);
    invalid.TimingValid = false;
    metrics.Observe(invalid, 1);
    metrics.Observe(Sample(-1), 1);
    metrics.Observe(Sample(300, 0), 1);
    metrics.Observe(Sample(300, -1), 1);
    metrics.Observe(Sample((std::numeric_limits<std::int64_t>::max)(), 1), 1);
    Check(metrics.InvalidTiming == 5 && metrics.Accepted == 7, "invalid accepted timing counted separately");
    Check(metrics.LastEnd == 300 && metrics.DurationSum == 200, "invalid timing cannot advance range");
    Check(metrics.First[1].Result == -1 && !metrics.First[3].TimingValid, "retain original failed and invalid observations");
}
void Retention() {
    VideoSampleMetrics metrics;
    const auto bytes = sizeof(metrics);
    for (std::int64_t index = 0; index < 10000; ++index) metrics.Observe(Sample(index * 100), 1);
    Check(sizeof(metrics) == bytes && bytes < 2048, "fixed memory bounded below 2 KiB");
    for (std::size_t index = 0; index < VideoSampleMetrics::RetainedCount; ++index) {
        Check(metrics.First[index].Pts == static_cast<std::int64_t>(index * 100), "first eight retained");
        const auto number = metrics.Attempts - VideoSampleMetrics::RetainedCount + index;
        Check(metrics.Last[number % VideoSampleMetrics::RetainedCount].Pts == static_cast<std::int64_t>(number * 100), "last eight ordered after ring wraps");
    }
    Check(metrics.LastEnd == 1000000 && metrics.DurationSum == 1000000, "long sequence coverage");
}
void Percentiles() {
    VideoSampleMetrics metrics;
    for (int index = 0; index < 19; ++index) metrics.Observe(Sample(index * 100), 1000);
    metrics.Observe(Sample(1900), 1000010);
    Check(metrics.WaitP95UpperUs() == 1000, "nearest rank p95 for twenty samples");
    Check(metrics.WaitMaxUs == 1000010 && metrics.WaitBuckets.back() == 1, "overflow bucket retains actual maximum");
    Check(metrics.WaitTotalUs == 1019010, "wait total includes outlier");
    VideoSampleMetrics single;
    single.Observe(Sample(0), 1251);
    Check(single.WaitP95UpperUs() == 1251, "percentile bound capped at observed maximum");
    VideoSampleMetrics boundary;
    for (std::size_t index = 0; index < VideoSampleMetrics::WaitUpperUs.size() - 1; ++index)
        boundary.Observe(Sample(static_cast<std::int64_t>(index * 100)), VideoSampleMetrics::WaitUpperUs[index]);
    for (std::size_t index = 0; index < VideoSampleMetrics::WaitUpperUs.size() - 1; ++index)
        Check(boundary.WaitBuckets[index] == 1, "each inclusive bucket boundary");
    Check(boundary.WaitP95UpperUs() == 1000000, "p95 rounds rank upward");
}
}
int main() {
    try {
        Timing(); Failures(); Retention(); Percentiles();
        std::cout << "PASS " << checks << " video sample metrics checks\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "FAIL " << error.what() << '\n';
        return 1;
    }
}
