#include "camera.hpp"
#include <new>

namespace xiaolu {
CameraFilter::CameraFilter() {
    ++gObjects; wcscpy_s(name_, kCameraName);
    stop_ = CreateEventW(nullptr, TRUE, FALSE, nullptr);
}
CameraFilter::~CameraFilter() {
    Stop(); pin_.Disconnect();
    if (clock_) clock_->Release();
    if (stop_) CloseHandle(stop_);
    --gObjects;
}
HRESULT CameraFilter::QueryInterface(REFIID iid, void** out) {
    if (!out) return E_POINTER; *out = nullptr;
    if (iid == IID_IUnknown || iid == IID_IPersist || iid == IID_IMediaFilter || iid == IID_IBaseFilter)
        *out = static_cast<IBaseFilter*>(this);
    else if (iid == IID_IAMStreamConfig) return pin_.QueryInterface(iid, out);
    else return E_NOINTERFACE;
    AddRef(); return S_OK;
}
ULONG CameraFilter::Release() { auto value = --refs_; if (!value) delete this; return value; }
HRESULT CameraFilter::GetClassID(CLSID* out) { if (!out) return E_POINTER; *out = kCameraClsid; return S_OK; }
HRESULT CameraFilter::Stop() {
    std::lock_guard<std::recursive_mutex> lock(mutex);
    state_ = State_Stopped;
    if (stop_) SetEvent(stop_);
    pin_.BeginDeliveryStop();
    if (worker_.joinable()) worker_.join();
    nextSampleTime_ = 0;
    pin_.EndDeliveryStop();
    return S_OK;
}
HRESULT CameraFilter::Pause() {
    std::lock_guard<std::recursive_mutex> lock(mutex);
    if (state_ == State_Running) {
        state_ = State_Paused;
        if (stop_) SetEvent(stop_);
        pin_.BeginDeliveryStop();
        if (worker_.joinable()) worker_.join();
        pin_.EndDeliveryStop();
    }
    state_ = State_Paused;
    return S_OK;
}
HRESULT CameraFilter::Run(REFERENCE_TIME start) {
    std::lock_guard<std::recursive_mutex> lock(mutex);
    if (state_ == State_Running) return S_OK;
    if (!stop_) return HRESULT_FROM_WIN32(ERROR_NOT_ENOUGH_MEMORY);
    HRESULT hr = pin_.Commit(); if (FAILED(hr)) return hr;
    start_ = start; state_ = State_Running; ResetEvent(stop_);
    if (pin_.Connected()) {
        try { worker_ = std::thread(&CameraFilter::DeliverLoop, this); }
        catch (...) { state_ = State_Stopped; pin_.BeginDeliveryStop(); pin_.EndDeliveryStop(); return E_OUTOFMEMORY; }
    }
    return S_OK;
}
void CameraFilter::DeliverLoop() {
    const HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    FrameChannel channel;
    LARGE_INTEGER frequency{}, origin{}, now{};
    QueryPerformanceFrequency(&frequency); QueryPerformanceCounter(&origin);
    uint64_t index = 0;
    while (WaitForSingleObject(stop_, 0) == WAIT_TIMEOUT) {
        QueryPerformanceCounter(&now);
        const double elapsed = double(now.QuadPart - origin.QuadPart) / frequency.QuadPart;
        const double due = double(index) / 30;
        if (elapsed < due) {
            const DWORD delay = static_cast<DWORD>((due - elapsed) * 1000);
            if (WaitForSingleObject(stop_, delay > 0 ? delay : 1) != WAIT_TIMEOUT) break;
            continue;
        }
        REFERENCE_TIME sampleTime = static_cast<REFERENCE_TIME>(elapsed * 10000000);
        if (clock_) {
            REFERENCE_TIME current;
            if (SUCCEEDED(clock_->GetTime(&current))) sampleTime = std::max<REFERENCE_TIME>(0, current - start_);
        }
        sampleTime = std::max(sampleTime, nextSampleTime_);
        HRESULT delivered = E_FAIL;
        try { delivered = pin_.Deliver(channel, sampleTime, index == 0); }
        catch (...) { delivered = E_OUTOFMEMORY; }
        if (FAILED(delivered)) {
            if (WaitForSingleObject(stop_, 0) == WAIT_TIMEOUT && graph_) {
                IMediaEventSink* events = nullptr;
                if (SUCCEEDED(graph_->QueryInterface(IID_IMediaEventSink, reinterpret_cast<void**>(&events)))) {
                    events->Notify(EC_ERRORABORT, delivered, 0); events->Release();
                }
            }
            break;
        }
        nextSampleTime_ = sampleTime + 10000000 / 30;
        ++index;
        // Drop missed delivery slots instead of building an ever-growing latency queue.
        QueryPerformanceCounter(&now);
        const double after = double(now.QuadPart - origin.QuadPart) / frequency.QuadPart;
        if (after > double(index + 1) / 30) index = static_cast<uint64_t>(after * 30) + 1;
    }
    if (SUCCEEDED(initialized)) CoUninitialize();
}
HRESULT CameraFilter::GetState(DWORD, FILTER_STATE* out) {
    if (!out) return E_POINTER; *out = state_;
    return *out == State_Paused ? VFW_S_CANT_CUE : S_OK;
}
HRESULT CameraFilter::SetSyncSource(IReferenceClock* clock) {
    std::lock_guard<std::recursive_mutex> lock(mutex);
    if (state_ == State_Running) return VFW_E_NOT_STOPPED;
    if (clock) clock->AddRef(); if (clock_) clock_->Release(); clock_ = clock; return S_OK;
}
HRESULT CameraFilter::GetSyncSource(IReferenceClock** out) {
    if (!out) return E_POINTER;
    std::lock_guard<std::recursive_mutex> lock(mutex);
    *out = clock_; if (clock_) clock_->AddRef(); return S_OK;
}
HRESULT CameraFilter::EnumPins(IEnumPins** out) { return CreatePinEnumerator(&pin_, out); }
HRESULT CameraFilter::FindPin(LPCWSTR id, IPin** out) {
    if (!id || !out) return E_POINTER; *out = nullptr;
    if (wcscmp(id, L"Capture") != 0) return VFW_E_NOT_FOUND;
    *out = &pin_; pin_.AddRef(); return S_OK;
}
HRESULT CameraFilter::QueryFilterInfo(FILTER_INFO* out) {
    if (!out) return E_POINTER;
    std::lock_guard<std::recursive_mutex> lock(mutex);
    *out = {}; wcscpy_s(out->achName, name_); out->pGraph = graph_;
    if (graph_) graph_->AddRef(); return S_OK;
}
HRESULT CameraFilter::JoinFilterGraph(IFilterGraph* graph, LPCWSTR name) {
    std::lock_guard<std::recursive_mutex> lock(mutex);
    graph_ = graph; if (name) wcsncpy_s(name_, name, _TRUNCATE); return S_OK;
}
}
