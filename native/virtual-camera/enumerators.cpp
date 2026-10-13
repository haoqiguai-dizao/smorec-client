#include "camera.hpp"
#include <new>

namespace xiaolu {
class PinEnumerator final : public IEnumPins {
    std::atomic<ULONG> refs_{1};
    IPin* pin_;
    ULONG position_ = 0;
public:
    explicit PinEnumerator(IPin* pin, ULONG position = 0) : pin_(pin), position_(position) { pin_->AddRef(); ++gObjects; }
    ~PinEnumerator() { pin_->Release(); --gObjects; }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (iid != IID_IUnknown && iid != IID_IEnumPins) return E_NOINTERFACE;
        *out = static_cast<IEnumPins*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override { auto value = --refs_; if (!value) delete this; return value; }
    HRESULT STDMETHODCALLTYPE Next(ULONG count, IPin** out, ULONG* fetched) override {
        if (!out || (!fetched && count != 1)) return E_POINTER;
        ULONG actual = 0;
        if (count && position_ == 0) { *out = pin_; pin_->AddRef(); position_ = 1; actual = 1; }
        if (fetched) *fetched = actual;
        return actual == count ? S_OK : S_FALSE;
    }
    HRESULT STDMETHODCALLTYPE Skip(ULONG count) override {
        const ULONG available = 1 - position_; position_ = (count || position_) ? 1 : 0;
        return count <= available ? S_OK : S_FALSE;
    }
    HRESULT STDMETHODCALLTYPE Reset() override { position_ = 0; return S_OK; }
    HRESULT STDMETHODCALLTYPE Clone(IEnumPins** out) override {
        if (!out) return E_POINTER; *out = new (std::nothrow) PinEnumerator(pin_, position_);
        return *out ? S_OK : E_OUTOFMEMORY;
    }
};
class TypeEnumerator final : public IEnumMediaTypes {
    std::atomic<ULONG> refs_{1};
    std::vector<VideoFormat> formats_;
    ULONG position_ = 0;
public:
    explicit TypeEnumerator(std::vector<VideoFormat> formats, ULONG position = 0)
        : formats_(std::move(formats)), position_(position) { ++gObjects; }
    ~TypeEnumerator() { --gObjects; }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (iid != IID_IUnknown && iid != IID_IEnumMediaTypes) return E_NOINTERFACE;
        *out = static_cast<IEnumMediaTypes*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override { auto value = --refs_; if (!value) delete this; return value; }
    HRESULT STDMETHODCALLTYPE Next(ULONG count, AM_MEDIA_TYPE** out, ULONG* fetched) override {
        if (!out || (!fetched && count != 1)) return E_POINTER;
        ULONG actual = 0;
        for (; actual < count && position_ < formats_.size(); ++actual, ++position_) {
            auto* type = static_cast<AM_MEDIA_TYPE*>(CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE)));
            if (!type) { if (fetched) *fetched = actual; return E_OUTOFMEMORY; }
            const HRESULT hr = MakeMediaType(formats_[position_], *type);
            if (FAILED(hr)) { CoTaskMemFree(type); if (fetched) *fetched = actual; return hr; }
            out[actual] = type;
        }
        if (fetched) *fetched = actual;
        return actual == count ? S_OK : S_FALSE;
    }
    HRESULT STDMETHODCALLTYPE Skip(ULONG count) override {
        const size_t available = formats_.size() - position_;
        position_ += static_cast<ULONG>(std::min<size_t>(count, available));
        return count <= available ? S_OK : S_FALSE;
    }
    HRESULT STDMETHODCALLTYPE Reset() override { position_ = 0; return S_OK; }
    HRESULT STDMETHODCALLTYPE Clone(IEnumMediaTypes** out) override {
        if (!out) return E_POINTER; *out = new (std::nothrow) TypeEnumerator(formats_, position_);
        return *out ? S_OK : E_OUTOFMEMORY;
    }
};
HRESULT CreatePinEnumerator(IPin* pin, IEnumPins** out) {
    if (!out) return E_POINTER; *out = new (std::nothrow) PinEnumerator(pin);
    return *out ? S_OK : E_OUTOFMEMORY;
}
HRESULT CreateTypeEnumerator(std::vector<VideoFormat> formats, IEnumMediaTypes** out) {
    if (!out) return E_POINTER; *out = new (std::nothrow) TypeEnumerator(std::move(formats));
    return *out ? S_OK : E_OUTOFMEMORY;
}
}
