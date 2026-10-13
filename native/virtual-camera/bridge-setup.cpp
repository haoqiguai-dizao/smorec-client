#include "bridge.hpp"
#include "camera.hpp"
#include "ownership.hpp"
#include <shellapi.h>
#include <iostream>
#include <iomanip>
#include <sstream>

namespace xiaolu {
std::wstring SiblingPath(const wchar_t* filename) {
    wchar_t module[32768]{};
    GetModuleFileNameW(nullptr, module, ARRAYSIZE(module));
    std::wstring path(module);
    return path.substr(0, path.find_last_of(L"\\/") + 1) + filename;
}
std::string JsonString(const std::wstring& value) {
    const int bytes = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    std::string utf8(bytes, '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.c_str(), static_cast<int>(value.size()), utf8.data(), bytes, nullptr, nullptr);
    std::ostringstream out; out << '"';
    for (const unsigned char ch : utf8) {
        if (ch == '"' || ch == '\\') out << '\\' << ch;
        else if (ch < 32) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(ch);
        else out << ch;
    }
    out << '"'; return out.str();
}
int ReportError(const char* stage, unsigned long code, const char* message) {
    std::cout << "{\"event\":\"error\",\"stage\":\"" << stage << "\",\"code\":" << code
        << ",\"message\":\"" << message << "\"}" << std::endl;
    return 1;
}
bool Elevated() {
    HANDLE token; TOKEN_ELEVATION elevation{}; DWORD bytes;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return false;
    const bool ok = GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &bytes) != FALSE;
    CloseHandle(token); return ok && elevation.TokenIsElevated;
}
int PrintStatus() {
    const auto registration = ReadCameraRegistration();
    if (registration.error != ERROR_SUCCESS && !RegistrationMissing(registration.error))
        return ReportError("status", registration.error, "Cannot read the camera registration");
    const std::wstring expected = SiblingPath(L"XiaoLu.VirtualCamera.dll");
    const bool installed = registration.error == ERROR_SUCCESS;
    const bool compatible = installed && OwnsCameraPath(registration.path, expected)
        && GetFileAttributesW(expected.c_str()) != INVALID_FILE_ATTRIBUTES;
    std::cout << "{\"installed\":" << (installed ? "true" : "false")
        << ",\"compatible\":" << (compatible ? "true" : "false")
        << ",\"architecture\":\"x64\",\"registeredPath\":" << JsonString(registration.path)
        << ",\"dllPath\":" << JsonString(expected) << ",\"elevated\":" << (Elevated() ? "true" : "false") << "}" << std::endl;
    return 0;
}
int InstallCamera(bool install, bool elevate, bool onlyIfOwned) {
    if (!install) {
        const auto registration = ReadCameraRegistration();
        // No registration means no mutation and no elevation, even for strict uninstall.
        if (RegistrationMissing(registration.error)) return PrintStatus();
        if (registration.error != ERROR_SUCCESS)
            return ReportError("ownership", registration.error, "Cannot verify camera registration ownership");
        if (!OwnsCameraPath(registration.path, SiblingPath(L"XiaoLu.VirtualCamera.dll"))) {
            if (onlyIfOwned) {
                std::cout << "{\"event\":\"skipped\",\"reason\":\"different-installation\"}" << std::endl;
                return PrintStatus();
            }
            return ReportError("ownership", ERROR_INVALID_OWNER, "The camera belongs to a different installation and was not removed");
        }
    }
    if (!Elevated()) {
        if (!elevate) return ReportError("registration", ERROR_ELEVATION_REQUIRED, "Administrator approval is required to register this camera");
        const std::wstring executable = SiblingPath(L"XiaoLu.CameraBridge.exe");
        SHELLEXECUTEINFOW operation{sizeof(operation)};
        operation.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        operation.lpVerb = L"runas"; operation.lpFile = executable.c_str();
        operation.lpParameters = install ? L"install" : (onlyIfOwned ? L"uninstall-if-owned" : L"uninstall"); operation.nShow = SW_HIDE;
        if (!ShellExecuteExW(&operation)) return ReportError("elevation", GetLastError(), "Camera setup was not approved or could not start");
        WaitForSingleObject(operation.hProcess, INFINITE);
        DWORD exitCode; GetExitCodeProcess(operation.hProcess, &exitCode); CloseHandle(operation.hProcess);
        if (exitCode) return ReportError("registration", exitCode, "Elevated camera setup failed");
        return PrintStatus();
    }
    const std::wstring path = SiblingPath(L"XiaoLu.VirtualCamera.dll");
    HMODULE dll = LoadLibraryExW(path.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (!dll) return ReportError("load", GetLastError(), "The camera DLL is missing or cannot be loaded");
    auto setup = reinterpret_cast<HRESULT(WINAPI*)()>(GetProcAddress(dll, install ? "DllRegisterServer" : "DllUnregisterServer"));
    const HRESULT hr = setup ? setup() : E_NOINTERFACE;
    FreeLibrary(dll);
    if (FAILED(hr)) return ReportError("registration", static_cast<unsigned long>(hr), "Camera device registration failed");
    return PrintStatus();
}
}
