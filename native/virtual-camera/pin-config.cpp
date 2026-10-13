#include "camera.hpp"

namespace xiaolu {
HRESULT CameraPin::SetFormat(AM_MEDIA_TYPE* type) {
    if (!type) return E_POINTER;
    std::lock_guard<std::recursive_mutex> lock(owner_->mutex);
    if (owner_->State() != State_Stopped) return VFW_E_NOT_STOPPED;
    VideoFormat candidate;
    const HRESULT hr = ParseMediaType(*type, candidate);
    if (FAILED(hr)) return hr;
    if (peer_ && (candidate.width != format_.width || candidate.height != format_.height || candidate.nv12 != format_.nv12))
        return VFW_E_ALREADY_CONNECTED;
    format_ = candidate; explicitFormat_ = true;
    return S_OK;
}
HRESULT CameraPin::GetFormat(AM_MEDIA_TYPE** out) {
    if (!out) return E_POINTER;
    std::lock_guard<std::recursive_mutex> lock(owner_->mutex);
    *out = static_cast<AM_MEDIA_TYPE*>(CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE)));
    if (!*out) return E_OUTOFMEMORY;
    const HRESULT hr = MakeMediaType(format_, **out);
    if (FAILED(hr)) { CoTaskMemFree(*out); *out = nullptr; }
    return hr;
}
HRESULT CameraPin::GetNumberOfCapabilities(int* count, int* size) {
    if (!count || !size) return E_POINTER;
    *count = kFormatCount; *size = sizeof(VIDEO_STREAM_CONFIG_CAPS); return S_OK;
}
HRESULT CameraPin::GetStreamCaps(int index, AM_MEDIA_TYPE** type, BYTE* caps) {
    if (!type || !caps) return E_POINTER; *type = nullptr;
    if (index < 0 || index >= kFormatCount) return S_FALSE;
    const auto format = FormatAt(index);
    *type = static_cast<AM_MEDIA_TYPE*>(CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE)));
    if (!*type) return E_OUTOFMEMORY;
    const HRESULT hr = MakeMediaType(format, **type);
    if (FAILED(hr)) { CoTaskMemFree(*type); *type = nullptr; return hr; }
    auto* config = reinterpret_cast<VIDEO_STREAM_CONFIG_CAPS*>(caps); *config = {};
    config->guid = FORMAT_VideoInfo;
    config->InputSize = config->MinCroppingSize = config->MaxCroppingSize = {format.width, format.height};
    config->MinOutputSize = config->MaxOutputSize = {format.width, format.height};
    config->CropGranularityX = config->CropGranularityY = config->OutputGranularityX = config->OutputGranularityY = 1;
    config->MinFrameInterval = config->MaxFrameInterval = 10000000 / 30;
    config->MinBitsPerSecond = config->MaxBitsPerSecond = FrameBytes(format) * 8 * 30;
    return S_OK;
}
HRESULT CameraPin::Get(REFGUID set, DWORD id, LPVOID, DWORD, LPVOID data, DWORD bytes, DWORD* returned) {
    if (set != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
    if (id != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
    if (returned) *returned = sizeof(GUID);
    if (!data) return returned ? S_OK : E_POINTER;
    if (bytes < sizeof(GUID)) return E_UNEXPECTED;
    *static_cast<GUID*>(data) = PIN_CATEGORY_CAPTURE; return S_OK;
}
HRESULT CameraPin::QuerySupported(REFGUID set, DWORD id, DWORD* support) {
    if (!support) return E_POINTER; *support = 0;
    if (set != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
    if (id != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
    *support = KSPROPERTY_SUPPORT_GET; return S_OK;
}
}
