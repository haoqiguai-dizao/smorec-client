#include "bridge.hpp"
#include "camera.hpp"
#include "ownership.hpp"
#include <wrl/client.h>
#include <iostream>

namespace xiaolu {
using Microsoft::WRL::ComPtr;
const CLSID kSampleGrabber = {0xc1f400a0,0x3f08,0x11d3,{0x9f,0x0b,0x00,0x60,0x08,0x03,0x9e,0x37}};
const CLSID kNullRenderer = {0xc1f400a4,0x3f08,0x11d3,{0x9f,0x0b,0x00,0x60,0x08,0x03,0x9e,0x37}};
MIDL_INTERFACE("0579154A-2B53-4994-B0D0-E773148EFF85") SampleCallback : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE SampleCB(double time, IMediaSample* sample) = 0;
    virtual HRESULT STDMETHODCALLTYPE BufferCB(double time, BYTE* buffer, long length) = 0;
};
MIDL_INTERFACE("6B652FFF-11FE-4fce-92AD-0266B5D7C78F") SampleGrabber : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE SetOneShot(BOOL) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetMediaType(const AM_MEDIA_TYPE*) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetConnectedMediaType(AM_MEDIA_TYPE*) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetBufferSamples(BOOL) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetCurrentBuffer(long*, long*) = 0;
    virtual HRESULT STDMETHODCALLTYPE GetCurrentSample(IMediaSample**) = 0;
    virtual HRESULT STDMETHODCALLTYPE SetCallback(SampleCallback*, long) = 0;
};
class Probe final : public SampleCallback {
    std::atomic<ULONG> refs_{1};
    double previous_ = -1;
public:
    std::vector<BYTE> expected;
    std::atomic<unsigned> frames{0}, matched{0}, invalid{0};
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (iid != IID_IUnknown && iid != __uuidof(SampleCallback)) return E_NOINTERFACE;
        *out = static_cast<SampleCallback*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override { return --refs_; }
    HRESULT STDMETHODCALLTYPE SampleCB(double time, IMediaSample* sample) override {
        BYTE* buffer = nullptr;
        const bool valid = sample && SUCCEEDED(sample->GetPointer(&buffer))
            && sample->GetActualDataLength() == static_cast<long>(expected.size()) && time > previous_;
        if (!valid) ++invalid;
        else if (std::memcmp(buffer, expected.data(), expected.size()) == 0) ++matched;
        previous_ = time; ++frames; return S_OK;
    }
    HRESULT STDMETHODCALLTYPE BufferCB(double, BYTE*, long) override { return E_NOTIMPL; }
};
HRESULT FirstPin(IBaseFilter* filter, PIN_DIRECTION direction, IPin** out) {
    ComPtr<IEnumPins> enumerator;
    HRESULT hr = filter->EnumPins(&enumerator); if (FAILED(hr)) return hr;
    ComPtr<IPin> pin;
    while (enumerator->Next(1, &pin, nullptr) == S_OK) {
        PIN_DIRECTION found;
        if (SUCCEEDED(pin->QueryDirection(&found)) && found == direction) { *out = pin.Detach(); return S_OK; }
        pin.Reset();
    }
    return VFW_E_NOT_FOUND;
}
HRESULT TestFormat(IClassFactory* factory, const VideoFormat& format, const FrameSnapshot* live, unsigned& count) {
    ComPtr<IBaseFilter> camera, grabFilter, renderer;
    ComPtr<IGraphBuilder> graph;
    ComPtr<IMediaControl> control;
    ComPtr<SampleGrabber> grabber;
    ComPtr<IPin> output, grabIn, grabOut, renderIn;
    ComPtr<IAMStreamConfig> config;
    HRESULT hr = factory->CreateInstance(nullptr, IID_PPV_ARGS(&camera));
    if (SUCCEEDED(hr)) hr = camera->FindPin(L"Capture", &output);
    if (SUCCEEDED(hr)) hr = output.As(&config);
    AM_MEDIA_TYPE type{};
    if (SUCCEEDED(hr)) hr = MakeMediaType(format, type);
    if (SUCCEEDED(hr)) hr = config->SetFormat(&type);
    if (SUCCEEDED(hr)) hr = CoCreateInstance(CLSID_FilterGraph, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&graph));
    if (SUCCEEDED(hr)) hr = CoCreateInstance(kSampleGrabber, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&grabFilter));
    if (SUCCEEDED(hr)) hr = CoCreateInstance(kNullRenderer, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&renderer));
    if (SUCCEEDED(hr)) hr = grabFilter.As(&grabber);
    if (SUCCEEDED(hr)) hr = grabber->SetMediaType(&type);
    if (SUCCEEDED(hr)) hr = graph->AddFilter(camera.Get(), L"XiaoLu test source");
    if (SUCCEEDED(hr)) hr = graph->AddFilter(grabFilter.Get(), L"XiaoLu sample probe");
    if (SUCCEEDED(hr)) hr = graph->AddFilter(renderer.Get(), L"XiaoLu null sink");
    if (SUCCEEDED(hr)) hr = FirstPin(grabFilter.Get(), PINDIR_INPUT, &grabIn);
    if (SUCCEEDED(hr)) hr = FirstPin(grabFilter.Get(), PINDIR_OUTPUT, &grabOut);
    if (SUCCEEDED(hr)) hr = FirstPin(renderer.Get(), PINDIR_INPUT, &renderIn);
    if (SUCCEEDED(hr)) hr = graph->ConnectDirect(output.Get(), grabIn.Get(), &type);
    if (SUCCEEDED(hr)) hr = graph->ConnectDirect(grabOut.Get(), renderIn.Get(), &type);
    if (SUCCEEDED(hr)) hr = graph.As(&control);
    Probe probe;
    probe.expected.resize(FrameBytes(format)); DrawFrame(live, format, probe.expected.data());
    if (SUCCEEDED(hr)) hr = grabber->SetCallback(&probe, 0);
    if (SUCCEEDED(hr)) hr = control->Run();
    if (SUCCEEDED(hr)) {
        const uint64_t deadline = GetTickCount64() + 2000;
        while (probe.frames < 5 && GetTickCount64() < deadline) Sleep(20);
    }
    if (SUCCEEDED(hr) && probe.frames >= 5) {
        const unsigned pausedAt = probe.frames;
        hr = control->Pause();
        if (SUCCEEDED(hr)) hr = control->Run();
        const uint64_t resumedDeadline = GetTickCount64() + 2000;
        while (SUCCEEDED(hr) && probe.frames < pausedAt + 5 && GetTickCount64() < resumedDeadline) Sleep(20);
        if (SUCCEEDED(hr) && probe.frames < pausedAt + 5) hr = E_FAIL;
    }
    if (control) control->Stop();
    if (grabber) grabber->SetCallback(nullptr, 0);
    if (SUCCEEDED(hr) && (probe.frames < 5 || probe.invalid || probe.matched < 2)) hr = E_FAIL;
    count += probe.frames;
    std::cout << "{\"event\":\"test-format\",\"width\":" << format.width << ",\"height\":" << format.height
        << ",\"format\":\"" << (format.nv12 ? "NV12" : "RGB32") << "\",\"frames\":" << probe.frames
        << ",\"matched\":" << probe.matched << ",\"invalid\":" << probe.invalid << ",\"hr\":" << static_cast<unsigned long>(hr) << "}" << std::endl;
    FreeMediaType(type);
    return hr;
}
int SelfTest(bool requireLive) {
    const std::wstring expected = L"C:\\Program Files\\小录\\resources\\virtual-camera\\XiaoLu.VirtualCamera.dll";
    const std::pair<const wchar_t*, bool> ownershipCases[] = {
        {L"C:\\Program Files\\小录\\resources\\virtual-camera\\XiaoLu.VirtualCamera.dll", true},
        {L"c:\\program files\\小录\\resources\\virtual-camera\\xiaolu.virtualcamera.DLL", true},
        {L"C:/Program Files/小录/resources/virtual-camera/XiaoLu.VirtualCamera.dll", true},
        {L"C:\\Program Files\\小录\\resources\\other\\..\\virtual-camera\\XiaoLu.VirtualCamera.dll", true},
        {L"C:\\Program Files\\小录-old\\resources\\virtual-camera\\XiaoLu.VirtualCamera.dll", false},
        {L"D:\\Program Files\\小录\\resources\\virtual-camera\\XiaoLu.VirtualCamera.dll", false},
        {L"C:\\Program Files\\小录\\resources\\virtual-camera\\Other.dll", false},
        {L"resources\\virtual-camera\\XiaoLu.VirtualCamera.dll", false},
        {L"\"C:\\Program Files\\小录\\resources\\virtual-camera\\XiaoLu.VirtualCamera.dll\"", false},
        {L"", false},
    };
    for (const auto& item : ownershipCases) {
        if (OwnsCameraPath(item.first, expected) != item.second)
            return ReportError("ownership-test", ERROR_INVALID_DATA, "Camera ownership path comparison failed");
    }
    std::cout << "{\"event\":\"test-ownership\",\"cases\":" << ARRAYSIZE(ownershipCases) << "}" << std::endl;
    FrameChannel channel; FrameSnapshot snapshot;
    const bool live = channel.Read(snapshot);
    if (requireLive && !live) return ReportError("self-test", ERROR_NOT_READY, "No current producer frame is available");
    if (!requireLive && live) return ReportError("self-test", ERROR_BUSY, "A live producer is active; use --require-live for a known constant frame");
    const auto path = SiblingPath(L"XiaoLu.VirtualCamera.dll");
    HMODULE dll = LoadLibraryExW(path.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!dll) return ReportError("self-test-load", GetLastError(), "Cannot load the camera DLL");
    auto getFactory = reinterpret_cast<HRESULT(WINAPI*)(REFCLSID, REFIID, void**)>(GetProcAddress(dll, "DllGetClassObject"));
    auto canUnload = reinterpret_cast<HRESULT(WINAPI*)()>(GetProcAddress(dll, "DllCanUnloadNow"));
    IClassFactory* factory = nullptr;
    HRESULT hr = getFactory ? getFactory(kCameraClsid, IID_IClassFactory, reinterpret_cast<void**>(&factory)) : E_NOINTERFACE;
    unsigned count = 0;
    for (int index = 0; index < kFormatCount && SUCCEEDED(hr); ++index) hr = TestFormat(factory, FormatAt(index), live ? &snapshot : nullptr, count);
    if (factory) factory->Release();
    if (SUCCEEDED(hr) && (!canUnload || canUnload() != S_OK)) hr = E_UNEXPECTED;
    // Direct loading avoids registering the XiaoLu device in the system registry.
    if (canUnload && canUnload() == S_OK) FreeLibrary(dll);
    if (FAILED(hr)) return ReportError("self-test", static_cast<unsigned long>(hr), "DirectShow graph, frame delivery or lifetime validation failed");
    std::cout << "{\"selfTest\":true,\"registered\":false,\"live\":" << (live ? "true" : "false")
        << ",\"formats\":" << kFormatCount << ",\"frames\":" << count << "}" << std::endl;
    return 0;
}
}
