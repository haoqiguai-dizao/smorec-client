#include "bridge.hpp"
#include "protocol.hpp"
#include <iostream>
#include <string>

namespace xiaolu {
int Stream(int argc, wchar_t** argv) {
    uint32_t width = 1920, height = 1080, fps = 30;
    for (int index = 2; index < argc; index += 2) {
        if (index + 1 >= argc) return ReportError("arguments", ERROR_INVALID_PARAMETER, "Missing stream option value");
        wchar_t* end = nullptr; const unsigned long value = wcstoul(argv[index + 1], &end, 10);
        if (!end || *end || value > 10000) return ReportError("arguments", ERROR_INVALID_PARAMETER, "Invalid stream option value");
        const std::wstring option(argv[index]);
        if (option == L"--width") width = value;
        else if (option == L"--height") height = value;
        else if (option == L"--fps") fps = value;
        else return ReportError("arguments", ERROR_INVALID_PARAMETER, "Unknown stream option");
    }
    FrameChannel channel; DWORD error = 0;
    if (!channel.Create(width, height, fps, error)) return ReportError("stream-start", error, "Unsupported format or another live output is already active");
    const size_t frameBytes = static_cast<size_t>(width) * height * 4;
    std::vector<uint8_t> pixels(frameBytes);
    std::cout << "{\"event\":\"ready\",\"width\":" << width << ",\"height\":" << height << ",\"fps\":" << fps
        << ",\"pixelFormat\":\"BGRA\",\"frameBytes\":" << frameBytes << "}" << std::endl;
    HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
    uint64_t frames = 0, dropped = 0;
    while (true) {
        size_t received = 0;
        while (received < frameBytes) {
            DWORD count = 0;
            if (!ReadFile(input, pixels.data() + received, static_cast<DWORD>(frameBytes - received), &count, nullptr)) {
                const DWORD readError = GetLastError();
                if (readError != ERROR_BROKEN_PIPE) return ReportError("stream-read", readError, "Cannot read frame input");
                count = 0;
            }
            if (!count) {
                channel.Close();
                if (received) return ReportError("stream-read", ERROR_INVALID_DATA, "Input closed midway through a BGRA frame");
                std::cout << "{\"event\":\"stopped\",\"frames\":" << frames << ",\"dropped\":" << dropped << "}" << std::endl;
                return 0;
            }
            received += count;
        }
        if (channel.Write(pixels.data(), pixels.size())) ++frames;
        else {
            ++dropped;
            if (dropped == 1 || dropped % 30 == 0) std::cout << "{\"event\":\"warning\",\"code\":\"reader-busy\",\"dropped\":" << dropped << "}" << std::endl;
        }
    }
}
}
int wmain(int argc, wchar_t** argv) {
    const HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    int result = 1;
    try {
        const std::wstring command = argc >= 2 ? argv[1] : L"status";
        if (command == L"status") result = xiaolu::PrintStatus();
        else if (command == L"stream") result = xiaolu::Stream(argc, argv);
        else if (command == L"install" || command == L"uninstall") result = xiaolu::InstallCamera(command == L"install", argc >= 3 && std::wstring(argv[2]) == L"--elevate");
        else if (command == L"uninstall-if-owned") result = xiaolu::InstallCamera(false, argc >= 3 && std::wstring(argv[2]) == L"--elevate", true);
        else if (command == L"self-test") result = xiaolu::SelfTest(argc >= 3 && std::wstring(argv[2]) == L"--require-live");
        else result = xiaolu::ReportError("arguments", ERROR_INVALID_PARAMETER, "Use status, stream, install, uninstall, uninstall-if-owned or self-test");
    } catch (...) { result = xiaolu::ReportError("runtime", ERROR_NOT_ENOUGH_MEMORY, "Native camera bridge could not complete the operation"); }
    if (SUCCEEDED(initialized)) CoUninitialize();
    return result;
}
