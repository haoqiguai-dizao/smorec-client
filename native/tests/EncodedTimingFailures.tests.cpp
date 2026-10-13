#include "EncodedSampleTiming.h"
#include "Log.h"
#include "CMFSinkWriterCallback.h"
#include "StaleWriterMaintenance.h"
#include <iostream>
#include <string>

bool isLoggingEnabled = false;
int logSeverityLevel = 0;
void _log(PCWSTR, ...) {}
std::wstring GetTimestamp() { return L""; }

int main() {
    EncodedSampleTiming asynchronous;
    asynchronous.OnFinalizeFailure(E_ACCESSDENIED, false);
    asynchronous.OnOutputFailure(E_ABORT);
    if (asynchronous.Status() != E_ACCESSDENIED || asynchronous.Finalized(S_OK) != E_ACCESSDENIED) return 1;
    EncodedSampleTiming begin;
    begin.OnFinalizeFailure(E_FAIL, true);
    if (begin.Finalized(S_OK) != E_FAIL) return 2;
    EncodedSampleTiming original;
    if (original.Finalized(E_ABORT) != E_ABORT) return 3;
    EncodedSampleTiming flush;
    flush.OnFlush(E_UNEXPECTED);
    if (flush.Finalized(S_OK) != E_UNEXPECTED) return 4;
    EncodedSampleTiming invalid;
    if (invalid.RestoreDuration(nullptr) != E_POINTER || invalid.Finalized(S_OK) != E_POINTER) return 5;
    EncodedSampleTiming empty;
    if (empty.Finalized(S_OK) != S_OK) return 6;
    bool active = true;
    if (empty.ObserveStaleMaintenance(active) != S_OK || active) return 14;
    if (ShouldObserveStaleWriter(false, true, false)) return 15;
    if (ShouldObserveStaleWriter(true, false, false)) return 16;
    if (ShouldObserveStaleWriter(true, true, true)) return 17;
    if (!ShouldObserveStaleWriter(true, true, false)) return 18;
    if (!IsStaleObservationRequested(nullptr) || !IsStaleObservationRequested(L"")) return 19;
    if (!IsStaleObservationRequested(L"observe") || IsStaleObservationRequested(L"flush")) return 20;
    if (!IsStaleObservationRequested(L"unrecognized")) return 21;
    EncodedSampleTiming maintenanceFailure;
    maintenanceFailure.OnOutputFailure(E_ACCESSDENIED);
    active = true;
    if (maintenanceFailure.ObserveStaleMaintenance(active) != E_ACCESSDENIED || active) return 22;
    if (maintenanceFailure.Finalized(S_OK) != E_ACCESSDENIED) return 23;
    auto failureBeforeFlush = std::make_shared<EncodedSampleTiming>();
    failureBeforeFlush->OnOutputFailure(E_ABORT);
    if (!SetEnvironmentVariableW(L"FRAMEFLOW_CAPTURE_STALE_MAINTENANCE", L"observe")) return 24;
    if (MaintainStaleWriter(failureBeforeFlush, nullptr, 0, false) != E_ABORT) return 25;
    EncodedSampleTiming writerFlush;
    writerFlush.AfterWriterFlush(writerFlush.BeforeWriterFlush(), E_ABORT);
    if (writerFlush.Finalized(S_OK) != E_ABORT) return 13;
    HANDLE event = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (!event) return 7;
    CMFSinkWriterCallback callback(event, nullptr);
    if (callback.GetFinalizeResult() != E_PENDING) return 8;
    if (callback.OnFinalize(E_ACCESSDENIED) != E_ACCESSDENIED) return 9;
    if (WaitForSingleObject(event, 0) != WAIT_OBJECT_0 || callback.GetFinalizeResult() != E_ACCESSDENIED) return 10;
    CMFSinkWriterCallback nextCallback(event, nullptr);
    if (nextCallback.GetFinalizeResult() != E_PENDING || nextCallback.OnFinalize(S_OK) != S_OK) return 11;
    if (WaitForSingleObject(event, 0) != WAIT_OBJECT_0 || nextCallback.GetFinalizeResult() != S_OK) return 12;
    CloseHandle(event);
    std::cout << "PASS asynchronous finalize, first failure, original failure, flush error, invalid sample, empty finalization and writer callback propagation checks\n";
    return 0;
}
