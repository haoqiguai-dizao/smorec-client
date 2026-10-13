#pragma once
#include <windows.h>
#include <cstdint>
#include <cstring>
#include <vector>

namespace xiaolu {
inline constexpr wchar_t kFrameMap[] = L"Local\\XiaoLu.VirtualCamera.Frames.v1";
inline constexpr wchar_t kFrameGate[] = L"Local\\XiaoLu.VirtualCamera.FrameGate.v1";
inline constexpr wchar_t kWriterLease[] = L"Local\\XiaoLu.VirtualCamera.Writer.v1";
inline constexpr uint32_t kMagic = 0x584c5643;
inline constexpr uint32_t kVersion = 1;
inline constexpr uint32_t kMaxPixels = 1920 * 1080;
inline constexpr uint32_t kMaxBytes = kMaxPixels * 4;
inline constexpr uint32_t kFreshMilliseconds = 2000;

// Fixed-width fields and an explicit layout are compatible with future x86 readers.
struct alignas(8) FrameHeader {
    uint32_t magic, version, headerBytes, capacity;
    uint32_t width, height, fps, active;
    uint64_t sequence, tickMilliseconds;
    uint32_t writerPid, reserved[3];
};
static_assert(sizeof(FrameHeader) == 64, "The shared protocol layout must stay stable");
struct FrameSnapshot {
    uint32_t width = 0, height = 0, fps = 30;
    uint64_t sequence = 0;
    std::vector<uint8_t> pixels;
};
inline bool SupportedSize(uint32_t width, uint32_t height) {
    return (width == 1920 && height == 1080) || (width == 1080 && height == 1920)
        || (width == 1280 && height == 720) || (width == 720 && height == 1280);
}

class FrameChannel {
    HANDLE mapping_ = nullptr, gate_ = nullptr, lease_ = nullptr;
    FrameHeader* header_ = nullptr;
    bool writer_ = false;
    uint64_t nextOpen_ = 0;
    bool Lock(DWORD timeout) {
        const DWORD result = WaitForSingleObject(gate_, timeout);
        return result == WAIT_OBJECT_0 || result == WAIT_ABANDONED;
    }
public:
    FrameChannel() = default;
    FrameChannel(const FrameChannel&) = delete;
    FrameChannel& operator=(const FrameChannel&) = delete;
    ~FrameChannel() { Close(); }
    bool Create(uint32_t width, uint32_t height, uint32_t fps, DWORD& error) {
        if (!SupportedSize(width, height) || fps != 30) { error = ERROR_INVALID_PARAMETER; return false; }
        lease_ = CreateMutexW(nullptr, TRUE, kWriterLease);
        if (!lease_) { error = GetLastError(); return false; }
        if (GetLastError() == ERROR_ALREADY_EXISTS) {
            const DWORD ownership = WaitForSingleObject(lease_, 0);
            if (ownership != WAIT_OBJECT_0 && ownership != WAIT_ABANDONED) {
                error = ERROR_BUSY; CloseHandle(lease_); lease_ = nullptr; return false;
            }
        }
        gate_ = CreateMutexW(nullptr, FALSE, kFrameGate);
        mapping_ = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0,
            static_cast<DWORD>(sizeof(FrameHeader) + kMaxBytes), kFrameMap);
        if (!gate_ || !mapping_) { error = GetLastError(); return false; }
        header_ = static_cast<FrameHeader*>(MapViewOfFile(mapping_, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(FrameHeader) + kMaxBytes));
        if (!header_) { error = GetLastError(); return false; }
        if (!Lock(1000)) { error = ERROR_TIMEOUT; return false; }
        *header_ = { kMagic, kVersion, sizeof(FrameHeader), kMaxBytes, width, height, fps, 0,
            0, GetTickCount64(), GetCurrentProcessId(), {0, 0, 0} };
        ReleaseMutex(gate_);
        writer_ = true;
        return true;
    }
    bool Write(const uint8_t* pixels, size_t count) {
        if (!writer_ || !Lock(8)) return false;
        const size_t bytes = static_cast<size_t>(header_->width) * header_->height * 4;
        if (count != bytes) { ReleaseMutex(gate_); return false; }
        std::memcpy(header_ + 1, pixels, bytes);
        header_->active = 1;
        header_->tickMilliseconds = GetTickCount64();
        ++header_->sequence;
        ReleaseMutex(gate_);
        return true;
    }
    bool Read(FrameSnapshot& frame) {
        if (!header_) {
            if (GetTickCount64() < nextOpen_) return false;
            nextOpen_ = GetTickCount64() + 500;
            gate_ = OpenMutexW(SYNCHRONIZE | MUTEX_MODIFY_STATE, FALSE, kFrameGate);
            mapping_ = OpenFileMappingW(FILE_MAP_READ, FALSE, kFrameMap);
            if (mapping_ && gate_) header_ = static_cast<FrameHeader*>(MapViewOfFile(mapping_, FILE_MAP_READ, 0, 0, sizeof(FrameHeader) + kMaxBytes));
            if (!header_) { Close(); return false; }
        }
        if (!Lock(8)) return false;
        const bool valid = header_->magic == kMagic && header_->version == kVersion
            && header_->headerBytes == sizeof(FrameHeader) && header_->capacity == kMaxBytes
            && header_->active == 1 && header_->fps == 30 && SupportedSize(header_->width, header_->height)
            && GetTickCount64() - header_->tickMilliseconds <= kFreshMilliseconds;
        if (valid) {
            frame.width = header_->width; frame.height = header_->height; frame.fps = header_->fps;
            frame.sequence = header_->sequence;
            frame.pixels.resize(static_cast<size_t>(frame.width) * frame.height * 4);
            std::memcpy(frame.pixels.data(), header_ + 1, frame.pixels.size());
        }
        ReleaseMutex(gate_);
        return valid;
    }
    void Close() {
        if (writer_ && header_ && gate_ && Lock(20)) {
            header_->active = 0; ReleaseMutex(gate_);
        }
        if (header_) UnmapViewOfFile(header_);
        if (mapping_) CloseHandle(mapping_);
        if (gate_) CloseHandle(gate_);
        if (lease_) { ReleaseMutex(lease_); CloseHandle(lease_); }
        header_ = nullptr; mapping_ = gate_ = lease_ = nullptr; writer_ = false;
    }
};
}
