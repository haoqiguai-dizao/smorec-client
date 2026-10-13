#pragma once
#include <windows.h>
#include <objbase.h>
#include <string>

namespace xiaolu {
std::wstring SiblingPath(const wchar_t* filename);
std::string JsonString(const std::wstring& value);
int ReportError(const char* stage, unsigned long code, const char* message);
int PrintStatus();
int InstallCamera(bool install, bool elevate, bool onlyIfOwned = false);
int SelfTest(bool requireLive);
}
