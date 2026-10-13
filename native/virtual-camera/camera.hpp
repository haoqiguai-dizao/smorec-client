#pragma once
#include <windows.h>
#include <dshow.h>
#include <dvdmedia.h>
#include <ks.h>
#include <ksmedia.h>
#include <atomic>
#include <mutex>
#include <vector>
#include <thread>
#include "protocol.hpp"

namespace xiaolu {
// Independent XiaoLu identity. Never reuse OBS's registered device identity.
inline constexpr CLSID kCameraClsid = {0x7d90fa14,0x1584,0x4e97,{0x94,0x37,0x0c,0x9d,0xe4,0xe7,0x52,0xcb}};
inline constexpr wchar_t kCameraName[] = L"小录 Virtual Camera";
inline constexpr wchar_t kClsidText[] = L"{7D90FA14-1584-4E97-9437-0C9DE4E752CB}";
inline constexpr GUID kNv12 = {0x3231564e,0x0000,0x0010,{0x80,0x00,0x00,0xaa,0x00,0x38,0x9b,0x71}};
inline constexpr int kFormatCount = 8;
extern std::atomic<long> gObjects;
extern HMODULE gModule;
struct VideoFormat { LONG width = 1920, height = 1080; bool nv12 = true; };
void FreeMediaType(AM_MEDIA_TYPE& type);
HRESULT CopyMediaType(AM_MEDIA_TYPE& to, const AM_MEDIA_TYPE& from);
HRESULT MakeMediaType(const VideoFormat& format, AM_MEDIA_TYPE& type);
HRESULT ParseMediaType(const AM_MEDIA_TYPE& type, VideoFormat& format);
VideoFormat FormatAt(int index);
LONG FrameBytes(const VideoFormat& format);
void DrawFrame(const FrameSnapshot* frame, const VideoFormat& format, BYTE* output);
HRESULT RegisterCamera(bool install);

class CameraFilter;
class CameraPin final : public IPin, public IAMStreamConfig, public IKsPropertySet {
    CameraFilter* owner_;
    IPin* peer_ = nullptr;
    IMemInputPin* input_ = nullptr;
    IMemAllocator* allocator_ = nullptr;
    AM_MEDIA_TYPE connection_{};
    VideoFormat format_{};
    FrameSnapshot snapshot_;
    bool explicitFormat_ = false;
    HRESULT ConnectWith(IPin* peer, const AM_MEDIA_TYPE& type);
public:
    explicit CameraPin(CameraFilter* owner) : owner_(owner) {}
    ~CameraPin();
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override;
    ULONG STDMETHODCALLTYPE AddRef() override;
    ULONG STDMETHODCALLTYPE Release() override;
    HRESULT STDMETHODCALLTYPE Connect(IPin* peer, const AM_MEDIA_TYPE* type) override;
    HRESULT STDMETHODCALLTYPE ReceiveConnection(IPin*, const AM_MEDIA_TYPE*) override { return VFW_E_INVALID_DIRECTION; }
    HRESULT STDMETHODCALLTYPE Disconnect() override;
    HRESULT STDMETHODCALLTYPE ConnectedTo(IPin** out) override;
    HRESULT STDMETHODCALLTYPE ConnectionMediaType(AM_MEDIA_TYPE* out) override;
    HRESULT STDMETHODCALLTYPE QueryPinInfo(PIN_INFO* out) override;
    HRESULT STDMETHODCALLTYPE QueryDirection(PIN_DIRECTION* out) override;
    HRESULT STDMETHODCALLTYPE QueryId(LPWSTR* out) override;
    HRESULT STDMETHODCALLTYPE QueryAccept(const AM_MEDIA_TYPE* type) override;
    HRESULT STDMETHODCALLTYPE EnumMediaTypes(IEnumMediaTypes** out) override;
    HRESULT STDMETHODCALLTYPE QueryInternalConnections(IPin**, ULONG*) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE EndOfStream() override { return E_UNEXPECTED; }
    HRESULT STDMETHODCALLTYPE BeginFlush() override { return E_UNEXPECTED; }
    HRESULT STDMETHODCALLTYPE EndFlush() override { return E_UNEXPECTED; }
    HRESULT STDMETHODCALLTYPE NewSegment(REFERENCE_TIME, REFERENCE_TIME, double) override { return S_OK; }
    HRESULT STDMETHODCALLTYPE SetFormat(AM_MEDIA_TYPE* type) override;
    HRESULT STDMETHODCALLTYPE GetFormat(AM_MEDIA_TYPE** out) override;
    HRESULT STDMETHODCALLTYPE GetNumberOfCapabilities(int* count, int* size) override;
    HRESULT STDMETHODCALLTYPE GetStreamCaps(int index, AM_MEDIA_TYPE** type, BYTE* caps) override;
    HRESULT STDMETHODCALLTYPE Set(REFGUID, DWORD, LPVOID, DWORD, LPVOID, DWORD) override { return E_NOTIMPL; }
    HRESULT STDMETHODCALLTYPE Get(REFGUID set, DWORD id, LPVOID, DWORD, LPVOID data, DWORD bytes, DWORD* returned) override;
    HRESULT STDMETHODCALLTYPE QuerySupported(REFGUID set, DWORD id, DWORD* support) override;
    HRESULT Commit();
    void BeginDeliveryStop();
    void EndDeliveryStop();
    HRESULT Deliver(FrameChannel& channel, REFERENCE_TIME start, bool first);
    bool Connected() const { return peer_ != nullptr; }
    const VideoFormat& Format() const { return format_; }
    std::vector<VideoFormat> Formats() const;
};

class CameraFilter final : public IBaseFilter {
public:
    std::recursive_mutex mutex;
private:
    std::atomic<ULONG> refs_{1};
    std::atomic<FILTER_STATE> state_{State_Stopped};
    IFilterGraph* graph_ = nullptr;
    IReferenceClock* clock_ = nullptr;
    wchar_t name_[128]{};
    CameraPin pin_{this};
    std::thread worker_;
    HANDLE stop_ = nullptr;
    REFERENCE_TIME start_ = 0;
    REFERENCE_TIME nextSampleTime_ = 0;
    void DeliverLoop();
public:
    CameraFilter();
    ~CameraFilter();
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override;
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override;
    HRESULT STDMETHODCALLTYPE GetClassID(CLSID* out) override;
    HRESULT STDMETHODCALLTYPE Stop() override;
    HRESULT STDMETHODCALLTYPE Pause() override;
    HRESULT STDMETHODCALLTYPE Run(REFERENCE_TIME start) override;
    HRESULT STDMETHODCALLTYPE GetState(DWORD, FILTER_STATE* out) override;
    HRESULT STDMETHODCALLTYPE SetSyncSource(IReferenceClock* clock) override;
    HRESULT STDMETHODCALLTYPE GetSyncSource(IReferenceClock** out) override;
    HRESULT STDMETHODCALLTYPE EnumPins(IEnumPins** out) override;
    HRESULT STDMETHODCALLTYPE FindPin(LPCWSTR id, IPin** out) override;
    HRESULT STDMETHODCALLTYPE QueryFilterInfo(FILTER_INFO* out) override;
    HRESULT STDMETHODCALLTYPE JoinFilterGraph(IFilterGraph* graph, LPCWSTR name) override;
    HRESULT STDMETHODCALLTYPE QueryVendorInfo(LPWSTR* out) override { if (out) *out = nullptr; return E_NOTIMPL; }
    FILTER_STATE State() const { return state_; }
};
HRESULT CreatePinEnumerator(IPin* pin, IEnumPins** out);
HRESULT CreateTypeEnumerator(std::vector<VideoFormat> formats, IEnumMediaTypes** out);
}
