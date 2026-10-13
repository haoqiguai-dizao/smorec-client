#include "MediaClockOrigin.h"
#include <mfapi.h>
#include <iostream>

int main() {
    if (MediaClockOriginFromCorrelation(5000000, 100000000) != 95000000) return 1;
    if (MediaClockOriginFromCorrelation(-1, 100) != -1) return 2;
    if (MediaClockOriginFromCorrelation(0, 0) != -1) return 3;
    if (MediaClockOriginFromCorrelation(101, 100) != -1) return 4;
    if (ReadMediaClockOriginQpc100ns(nullptr) != -1) return 5;
    if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) || FAILED(MFStartup(MF_VERSION))) return 6;
    CComPtr<IMFPresentationClock> clock;
    CComPtr<IMFPresentationTimeSource> source;
    if (FAILED(MFCreatePresentationClock(&clock)) || FAILED(MFCreateSystemTimeSource(&source))) return 7;
    if (ReadMediaClockOriginQpc100ns(clock) != -1 || FAILED(clock->SetTimeSource(source))) return 8;
    const LONGLONG before = MFGetSystemTime();
    if (FAILED(clock->Start(0))) return 9;
    const LONGLONG after = MFGetSystemTime();
    const LONGLONG origin = ReadMediaClockOriginQpc100ns(clock);
    if (origin < before || origin > after) return 10;
    Sleep(25);
    const LONGLONG later = ReadMediaClockOriginQpc100ns(clock);
    if (later < origin - 100 || later > origin + 100) return 11;
    if (FAILED(clock->Pause()) || ReadMediaClockOriginQpc100ns(clock) != -1) return 12;
    if (FAILED(clock->Stop()) || ReadMediaClockOriginQpc100ns(clock) != -1) return 13;
    CComQIPtr<IMFShutdown> shutdown(clock);
    if (shutdown) shutdown->Shutdown();
    clock.Release(); source.Release(); shutdown.Release();
    MFShutdown(); CoUninitialize();
    std::cout << "PASS clock correlation arithmetic, invalid state, actual running QPC origin, stable mapping, pause and stop checks\n";
    return 0;
}
