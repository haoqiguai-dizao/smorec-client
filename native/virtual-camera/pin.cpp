#include "camera.hpp"
#include <algorithm>
#include <wrl/client.h>

namespace xiaolu {
CameraPin::~CameraPin() { Disconnect(); }
ULONG CameraPin::AddRef() { return owner_->AddRef(); }
ULONG CameraPin::Release() { return owner_->Release(); }
HRESULT CameraPin::QueryInterface(REFIID iid, void** out) {
    if (!out) return E_POINTER; *out = nullptr;
    if (iid == IID_IUnknown || iid == IID_IPin) *out = static_cast<IPin*>(this);
    else if (iid == IID_IAMStreamConfig) *out = static_cast<IAMStreamConfig*>(this);
    else if (iid == IID_IKsPropertySet) *out = static_cast<IKsPropertySet*>(this);
    else return E_NOINTERFACE;
    AddRef(); return S_OK;
}
std::vector<VideoFormat> CameraPin::Formats() const {
    std::vector<VideoFormat> result{format_};
    if (explicitFormat_) return result;
    for (int index = 0; index < kFormatCount; ++index) {
        const auto candidate = FormatAt(index);
        if (candidate.width != format_.width || candidate.height != format_.height || candidate.nv12 != format_.nv12)
            result.push_back(candidate);
    }
    return result;
}
HRESULT CameraPin::ConnectWith(IPin* peer, const AM_MEDIA_TYPE& type) {
    VideoFormat candidate;
    HRESULT hr = ParseMediaType(type, candidate);
    if (FAILED(hr)) return hr;
    if (explicitFormat_ && (candidate.width != format_.width || candidate.height != format_.height || candidate.nv12 != format_.nv12))
        return VFW_E_TYPE_NOT_ACCEPTED;
    PIN_DIRECTION direction;
    if (FAILED(peer->QueryDirection(&direction)) || direction != PINDIR_INPUT) return VFW_E_INVALID_DIRECTION;
    hr = peer->QueryInterface(IID_IMemInputPin, reinterpret_cast<void**>(&input_));
    if (FAILED(hr)) return hr;
    hr = peer->ReceiveConnection(this, &type);
    if (FAILED(hr)) { input_->Release(); input_ = nullptr; return hr; }
    hr = input_->GetAllocator(&allocator_);
    if (FAILED(hr) || !allocator_) hr = CoCreateInstance(CLSID_MemoryAllocator, nullptr,
        CLSCTX_INPROC_SERVER, IID_IMemAllocator, reinterpret_cast<void**>(&allocator_));
    if (SUCCEEDED(hr)) {
        ALLOCATOR_PROPERTIES required{}, requested{3, FrameBytes(candidate), 1, 0}, actual{};
        if (SUCCEEDED(input_->GetAllocatorRequirements(&required))) {
            requested.cBuffers = std::max(requested.cBuffers, required.cBuffers);
            requested.cbAlign = std::max(requested.cbAlign, required.cbAlign);
            requested.cbPrefix = std::max(requested.cbPrefix, required.cbPrefix);
        }
        hr = allocator_->SetProperties(&requested, &actual);
        if (SUCCEEDED(hr) && (actual.cbBuffer < requested.cbBuffer || actual.cBuffers < 1)) hr = E_FAIL;
        if (SUCCEEDED(hr)) hr = input_->NotifyAllocator(allocator_, FALSE);
    }
    if (SUCCEEDED(hr)) hr = CopyMediaType(connection_, type);
    if (FAILED(hr)) {
        peer->Disconnect();
        if (allocator_) { allocator_->Release(); allocator_ = nullptr; }
        input_->Release(); input_ = nullptr; return hr;
    }
    peer_ = peer; peer_->AddRef(); format_ = candidate;
    return S_OK;
}
HRESULT CameraPin::Connect(IPin* peer, const AM_MEDIA_TYPE* type) {
    if (!peer) return E_POINTER;
    std::lock_guard<std::recursive_mutex> lock(owner_->mutex);
    if (owner_->State() != State_Stopped) return VFW_E_NOT_STOPPED;
    if (peer_) return VFW_E_ALREADY_CONNECTED;
    if (type && type->formattype != GUID_NULL && type->cbFormat) return ConnectWith(peer, *type);
    for (const auto& candidate : Formats()) {
        AM_MEDIA_TYPE current{};
        HRESULT hr = MakeMediaType(candidate, current);
        if (FAILED(hr)) return hr;
        const bool matches = !type || ((type->majortype == GUID_NULL || type->majortype == current.majortype)
            && (type->subtype == GUID_NULL || type->subtype == current.subtype));
        if (matches) hr = ConnectWith(peer, current); else hr = VFW_E_TYPE_NOT_ACCEPTED;
        FreeMediaType(current);
        if (SUCCEEDED(hr)) return hr;
    }
    return VFW_E_NO_ACCEPTABLE_TYPES;
}
HRESULT CameraPin::Disconnect() {
    std::lock_guard<std::recursive_mutex> lock(owner_->mutex);
    if (owner_->State() != State_Stopped) return VFW_E_NOT_STOPPED;
    const bool connected = peer_ != nullptr;
    if (allocator_) { allocator_->Release(); allocator_ = nullptr; }
    if (input_) { input_->Release(); input_ = nullptr; }
    if (peer_) { peer_->Release(); peer_ = nullptr; }
    FreeMediaType(connection_);
    return connected ? S_OK : S_FALSE;
}
HRESULT CameraPin::ConnectedTo(IPin** out) {
    if (!out) return E_POINTER;
    std::lock_guard<std::recursive_mutex> lock(owner_->mutex);
    *out = peer_; if (!peer_) return VFW_E_NOT_CONNECTED;
    peer_->AddRef(); return S_OK;
}
HRESULT CameraPin::ConnectionMediaType(AM_MEDIA_TYPE* out) {
    if (!out) return E_POINTER;
    std::lock_guard<std::recursive_mutex> lock(owner_->mutex);
    *out = {}; return peer_ ? CopyMediaType(*out, connection_) : VFW_E_NOT_CONNECTED;
}
HRESULT CameraPin::QueryPinInfo(PIN_INFO* out) {
    if (!out) return E_POINTER; *out = {};
    out->pFilter = owner_; owner_->AddRef(); out->dir = PINDIR_OUTPUT;
    wcscpy_s(out->achName, L"Capture"); return S_OK;
}
HRESULT CameraPin::QueryDirection(PIN_DIRECTION* out) { if (!out) return E_POINTER; *out = PINDIR_OUTPUT; return S_OK; }
HRESULT CameraPin::QueryId(LPWSTR* out) {
    if (!out) return E_POINTER;
    *out = static_cast<LPWSTR>(CoTaskMemAlloc(sizeof(L"Capture")));
    if (!*out) return E_OUTOFMEMORY; std::memcpy(*out, L"Capture", sizeof(L"Capture")); return S_OK;
}
HRESULT CameraPin::QueryAccept(const AM_MEDIA_TYPE* type) {
    if (!type) return E_POINTER;
    VideoFormat candidate;
    return SUCCEEDED(ParseMediaType(*type, candidate)) ? S_OK : S_FALSE;
}
HRESULT CameraPin::EnumMediaTypes(IEnumMediaTypes** out) {
    std::lock_guard<std::recursive_mutex> lock(owner_->mutex);
    return CreateTypeEnumerator(Formats(), out);
}
HRESULT CameraPin::Commit() { return allocator_ ? allocator_->Commit() : S_OK; }
void CameraPin::BeginDeliveryStop() {
    if (peer_) peer_->BeginFlush();
    if (allocator_) allocator_->Decommit();
}
void CameraPin::EndDeliveryStop() { if (peer_) peer_->EndFlush(); }
HRESULT CameraPin::Deliver(FrameChannel& channel, REFERENCE_TIME start, bool first) {
    if (!allocator_ || !input_) return VFW_E_NOT_CONNECTED;
    Microsoft::WRL::ComPtr<IMediaSample> sample;
    HRESULT hr = allocator_->GetBuffer(&sample, nullptr, nullptr, 0);
    if (FAILED(hr)) return hr;
    BYTE* pixels = nullptr;
    hr = sample->GetPointer(&pixels);
    if (SUCCEEDED(hr) && sample->GetSize() < FrameBytes(format_)) hr = E_FAIL;
    if (SUCCEEDED(hr)) {
        const bool live = channel.Read(snapshot_);
        DrawFrame(live ? &snapshot_ : nullptr, format_, pixels);
        REFERENCE_TIME end = start + 10000000 / 30;
        sample->SetTime(&start, &end); sample->SetMediaTime(nullptr, nullptr);
        sample->SetActualDataLength(FrameBytes(format_)); sample->SetSyncPoint(TRUE);
        sample->SetDiscontinuity(first ? TRUE : FALSE); sample->SetPreroll(FALSE);
        hr = input_->Receive(sample.Get());
    }
    return hr;
}
}
