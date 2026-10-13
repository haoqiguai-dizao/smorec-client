#include <windows.h>
#include <string>
#include <fstream>

// Isolated NSIS test fixture. Never reads/writes camera registry or requests UAC.
int wmain(int argc, wchar_t** argv) {
    wchar_t file[32768]{}; GetModuleFileNameW(nullptr, file, ARRAYSIZE(file));
    const std::wstring path(file), directory = path.substr(0, path.find_last_of(L"\\/") + 1);
    std::ofstream marker(directory + L"invoked.txt");
    marker << "called"; marker.close();
    if (argc != 3 || std::wstring(argv[1]) != L"uninstall-if-owned" || std::wstring(argv[2]) != L"--elevate") return 77;
    std::ifstream codeFile(directory + L"exit-code.txt");
    int code = 1; codeFile >> code;
    return code;
}
