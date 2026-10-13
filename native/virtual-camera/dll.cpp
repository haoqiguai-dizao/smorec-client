#include "camera.hpp"
#include "ownership.hpp"
#include <new>
#include <string>

namespace xiaolu {
std::atomic<long> gObjects{0};
HMODULE gModule = nullptr;
class Factory final : public IClassFactory {
    std::atomic<ULONG> refs_{1};
public:
    Factory() { ++gObjects; }
    ~Factory() { --gObjects; }
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (iid != IID_IUnknown && iid != IID_IClassFactory) return E_NOINTERFACE;
        *out = static_cast<IClassFactory*>(this); AddRef(); return S_OK;
    }
    ULONG STDMETHODCALLTYPE AddRef() override { return ++refs_; }
    ULONG STDMETHODCALLTYPE Release() override { auto value = --refs_; if (!value) delete this; return value; }
    HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown* outer, REFIID iid, void** out) override {
        if (!out) return E_POINTER; *out = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        CameraFilter* filter = nullptr;
        try { filter = new (std::nothrow) CameraFilter; }
        catch (...) { return E_OUTOFMEMORY; }
        if (!filter) return E_OUTOFMEMORY;
        const HRESULT hr = filter->QueryInterface(iid, out); filter->Release(); return hr;
    }
    HRESULT STDMETHODCALLTYPE LockServer(BOOL lock) override { if (lock) ++gObjects; else --gObjects; return S_OK; }
};
HRESULT SetRegistryString(HKEY root, const std::wstring& path, const wchar_t* keyName, const wchar_t* value) {
    HKEY key;
    LSTATUS error = RegCreateKeyExW(root, path.c_str(), 0, nullptr, 0, KEY_WRITE, nullptr, &key, nullptr);
    if (error != ERROR_SUCCESS) return HRESULT_FROM_WIN32(error);
    error = RegSetValueExW(key, keyName, 0, REG_SZ, reinterpret_cast<const BYTE*>(value),
        static_cast<DWORD>((wcslen(value) + 1) * sizeof(wchar_t)));
    RegCloseKey(key); return HRESULT_FROM_WIN32(error);
}
class RegistrationGate {
    HANDLE mutex_ = CreateMutexW(nullptr, FALSE, L"Global\\XiaoLu.VirtualCamera.Registration.v1");
    bool locked_ = false;
public:
    HRESULT Acquire() {
        if (!mutex_) return HRESULT_FROM_WIN32(GetLastError());
        const DWORD wait = WaitForSingleObject(mutex_, 10000);
        locked_ = wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED;
        return locked_ ? S_OK : HRESULT_FROM_WIN32(wait == WAIT_TIMEOUT ? ERROR_TIMEOUT : GetLastError());
    }
    ~RegistrationGate() { if (locked_) ReleaseMutex(mutex_); if (mutex_) CloseHandle(mutex_); }
};
HRESULT RegisterCamera(bool install) {
    RegistrationGate gate;
    const HRESULT acquired = gate.Acquire(); if (FAILED(acquired)) return acquired;
    wchar_t modulePath[32768]{};
    if (!GetModuleFileNameW(gModule, modulePath, ARRAYSIZE(modulePath))) return HRESULT_FROM_WIN32(GetLastError());
    if (!install) {
        // Recheck inside the elevated DLL, under the common registration lock.
        const auto registration = ReadCameraRegistration();
        if (RegistrationMissing(registration.error)) return S_OK;
        if (registration.error != ERROR_SUCCESS) return HRESULT_FROM_WIN32(registration.error);
        if (!OwnsCameraPath(registration.path, modulePath)) return HRESULT_FROM_WIN32(ERROR_INVALID_OWNER);
    }
    IFilterMapper2* mapper = nullptr;
    HRESULT hr = CoCreateInstance(CLSID_FilterMapper2, nullptr, CLSCTX_INPROC_SERVER,
        IID_IFilterMapper2, reinterpret_cast<void**>(&mapper));
    if (FAILED(hr)) return hr;
    const std::wstring path = std::wstring(L"Software\\Classes\\CLSID\\") + kClsidText;
    if (!install) {
        hr = mapper->UnregisterFilter(&CLSID_VideoInputDeviceCategory, kCameraName, kCameraClsid);
        const LSTATUS error = RegDeleteTreeW(HKEY_LOCAL_MACHINE, path.c_str());
        mapper->Release();
        if (error != ERROR_SUCCESS && error != ERROR_FILE_NOT_FOUND) return HRESULT_FROM_WIN32(error);
        return FAILED(hr) && hr != HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND) ? hr : S_OK;
    }

    hr = SetRegistryString(HKEY_LOCAL_MACHINE, path, nullptr, kCameraName);
    if (SUCCEEDED(hr)) hr = SetRegistryString(HKEY_LOCAL_MACHINE, path + L"\\InprocServer32", nullptr, modulePath);
    if (SUCCEEDED(hr)) hr = SetRegistryString(HKEY_LOCAL_MACHINE, path + L"\\InprocServer32", L"ThreadingModel", L"Both");
    if (SUCCEEDED(hr)) {
        REGPINTYPES types[] = {{&MEDIATYPE_Video, &kNv12}, {&MEDIATYPE_Video, &MEDIASUBTYPE_RGB32}};
        REGFILTERPINS2 pin{};
        pin.dwFlags = REG_PINFLAG_B_OUTPUT; pin.cInstances = 1;
        pin.nMediaTypes = ARRAYSIZE(types); pin.lpMediaType = types; pin.clsPinCategory = &PIN_CATEGORY_CAPTURE;
        REGFILTER2 filter{}; filter.dwVersion = 2; filter.dwMerit = MERIT_DO_NOT_USE;
        filter.cPins2 = 1; filter.rgPins2 = &pin;
        hr = mapper->RegisterFilter(kCameraClsid, kCameraName, nullptr, &CLSID_VideoInputDeviceCategory, kCameraName, &filter);
    }
    if (FAILED(hr)) RegDeleteTreeW(HKEY_LOCAL_MACHINE, path.c_str());
    mapper->Release(); return hr;
}
}
extern "C" BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) { xiaolu::gModule = instance; DisableThreadLibraryCalls(instance); }
    return TRUE;
}
extern "C" HRESULT WINAPI DllGetClassObject(REFCLSID clsid, REFIID iid, void** out) {
    if (!out) return E_POINTER; *out = nullptr;
    if (clsid != xiaolu::kCameraClsid) return CLASS_E_CLASSNOTAVAILABLE;
    auto* factory = new (std::nothrow) xiaolu::Factory;
    if (!factory) return E_OUTOFMEMORY;
    const HRESULT hr = factory->QueryInterface(iid, out); factory->Release(); return hr;
}
extern "C" HRESULT WINAPI DllCanUnloadNow() { return xiaolu::gObjects == 0 ? S_OK : S_FALSE; }
extern "C" HRESULT WINAPI DllRegisterServer() { return xiaolu::RegisterCamera(true); }
extern "C" HRESULT WINAPI DllUnregisterServer() { return xiaolu::RegisterCamera(false); }
