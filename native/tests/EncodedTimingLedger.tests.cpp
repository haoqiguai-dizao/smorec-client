#include "EncodedTimingLedger.h"
#include <iostream>
#include <stdexcept>

namespace {
unsigned checks = 0;
using Result = EncodedTimingLedger::Result;
void Check(bool value, const char* name) { ++checks; if (!value) throw std::runtime_error(name); }
void ExactMatching() {
    EncodedTimingLedger ledger;
    std::uint64_t token = 0;
    std::int64_t duration = 0;
    Check(ledger.Insert(0, 1234, token) == Result::Ok, "first timestamp zero");
    Check(ledger.Insert(1234, 4567, token) == Result::Ok, "variable duration");
    Check(ledger.Take(1235, duration) == Result::Unknown && ledger.Count() == 2, "never approximate timestamps");
    Check(ledger.Take(1234, duration) == Result::Ok && duration == 4567, "exact reordered output");
    Check(ledger.Take(0, duration) == Result::Ok && duration == 1234, "earlier reordered output survives");
    Check(ledger.Take(0, duration) == Result::Unknown, "duplicate output rejected");
    Check(ledger.Insert(1234, 1, token) == Result::Duplicate, "consumed input timestamp cannot recur");
    Check(ledger.Insert(10, 1, token) == Result::Invalid, "input clock cannot move backward");
    Check(ledger.Count() == 0, "all inputs matched");
}
void BoundsAndFailures() {
    EncodedTimingLedger ledger;
    std::uint64_t token = 0;
    Check(ledger.Insert(-1, 1, token) == Result::Invalid, "negative input timestamp");
    Check(ledger.Insert(0, 0, token) == Result::Invalid, "zero duration");
    Check(ledger.Insert(0, -1, token) == Result::Invalid, "negative duration");
    Check(ledger.Insert((std::numeric_limits<std::int64_t>::max)(), 1, token) == Result::Invalid, "timestamp end overflow");
    for (std::int64_t index = 0; index < static_cast<std::int64_t>(EncodedTimingLedger::Capacity); ++index)
        Check(ledger.Insert(index * 100, index + 1, token) == Result::Ok, "fill bounded metadata capacity");
    Check(ledger.Insert(51200, 1, token) == Result::Full && ledger.Count() == 512, "capacity exhausted without eviction");
    std::int64_t duration = 0;
    Check(ledger.Take(0, duration) == Result::Ok && duration == 1, "oldest input retained when full");
    Check(ledger.Insert(51200, 222, token) == Result::Ok, "released slot reused");
    Check(ledger.Cancel(token) && ledger.Count() == 511, "failed input write removes only its token");
    Check(!ledger.Cancel(token), "cancel is idempotent");
    Check(ledger.Clear() == 511 && ledger.Count() == 0, "original flush accounts for discarded metadata");
    Check(ledger.Take(100, duration) == Result::Unknown, "originally flushed timestamps are not resurrected");
    Check(ledger.Insert(51300, 456, token) == Result::Ok, "continuous input resumes after flush");
    Check(ledger.Count() == 1, "finalization can detect an unconsumed input");
}
void LongSequenceAndSynchronousCallback() {
    EncodedTimingLedger ledger;
    std::uint64_t previousToken = 0;
    std::int64_t duration = 0;
    for (std::int64_t index = 0; index < 10000; ++index) {
        std::uint64_t token = 0;
        Check(ledger.Insert(index * 1000, 1000 + index, token) == Result::Ok, "long sequence insert");
        Check(token > previousToken, "tokens never alias reused slots");
        // The sink may consume synchronously before WriteSample returns.
        Check(ledger.Take(index * 1000, duration) == Result::Ok && duration == 1000 + index, "synchronous callback matches registered input");
        Check(!ledger.Cancel(token), "late write failure cannot remove a different reused slot");
        previousToken = token;
    }
    Check(ledger.Count() == 0 && sizeof(ledger) < 20000, "memory remains fixed after long session");
}
void WriterFlushBoundary() {
    EncodedTimingLedger ledger;
    std::uint64_t token = 0;
    std::int64_t duration = 0;
    Check(ledger.Insert(0, 100, token) == Result::Ok, "old input before writer flush");
    const auto watermark = ledger.Watermark();
    Check(ledger.Insert(100, 250, token) == Result::Ok, "new input after writer flush boundary");
    Check(ledger.DiscardThrough(watermark) == 1 && ledger.Count() == 1, "writer flush discards only old metadata");
    Check(ledger.DiscardThrough(watermark) == 0, "stream and writer flush do not double count");
    Check(ledger.Take(0, duration) == Result::Unknown, "discarded old output rejected explicitly");
    Check(ledger.Take(100, duration) == Result::Ok && duration == 250, "new accepted input survives old flush");
}
}
int main() {
    try {
        ExactMatching(); BoundsAndFailures(); LongSequenceAndSynchronousCallback(); WriterFlushBoundary();
        std::cout << "PASS " << checks << " encoded timing ledger checks\n";
        return 0;
    } catch (const std::exception& error) { std::cerr << "FAIL " << error.what() << '\n'; return 1; }
}
