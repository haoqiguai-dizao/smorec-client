#pragma once
#include <windows.h>
#include <string>
#include <algorithm>

namespace xiaolu {
struct CameraRegistration { LSTATUS error = ERROR_FILE_NOT_FOUND; std::wstring path; };
inline std::wstring CanonicalCameraPath(std::wstring path) {
    std::replace(path.begin(), path.end(), L'/', L'\\');
    // Registry ownership never depends on the caller's working directory.
    const bool absolute = path.size() >= 3 && path[1] == L':' && path[2] == L'\\';
    const bool unc = path.size() >= 3 && path[0] == L'\\' && path[1] == L'\\';
    if ((!absolute && !unc) || path.find(L'"') != std::wstring::npos) return {};
    wchar_t full[32768]{};
    const DWORD size = GetFullPathNameW(path.c_str(), ARRAYSIZE(full), full, nullptr);
    return size > 0 && size < ARRAYSIZE(full) ? std::wstring(full, size) : std::wstring{};
}
inline bool OwnsCameraPath(const std::wstring& registered, const std::wstring& expected) {
    const auto actual = CanonicalCameraPath(registered), ours = CanonicalCameraPath(expected);
    return !actual.empty() && !ours.empty() && _wcsicmp(actual.c_str(), ours.c_str()) == 0;
}
inline bool RegistrationMissing(LSTATUS error) { return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND; }
inline CameraRegistration ReadCameraRegistration() {
    CameraRegistration result;
    const wchar_t* key = L"Software\\Classes\\CLSID\\{7D90FA14-1584-4E97-9437-0C9DE4E752CB}\\InprocServer32";
    wchar_t value[32768]{}; DWORD bytes = sizeof(value);
    result.error = RegGetValueW(HKEY_LOCAL_MACHINE, key, nullptr,
        RRF_RT_REG_SZ | RRF_SUBKEY_WOW6464KEY, nullptr, value, &bytes);
    if (result.error == ERROR_SUCCESS) result.path = value;
    return result;
}
}
