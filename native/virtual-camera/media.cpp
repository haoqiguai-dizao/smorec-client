#include "camera.hpp"
#include <algorithm>

namespace xiaolu {
void FreeMediaType(AM_MEDIA_TYPE& type) {
    if (type.cbFormat) CoTaskMemFree(type.pbFormat);
    if (type.pUnk) type.pUnk->Release();
    type = {};
}
HRESULT CopyMediaType(AM_MEDIA_TYPE& to, const AM_MEDIA_TYPE& from) {
    to = from; to.pbFormat = nullptr;
    if (from.cbFormat) {
        if (!from.pbFormat) { to = {}; return E_INVALIDARG; }
        to.pbFormat = static_cast<BYTE*>(CoTaskMemAlloc(from.cbFormat));
        if (!to.pbFormat) { to = {}; return E_OUTOFMEMORY; }
        std::memcpy(to.pbFormat, from.pbFormat, from.cbFormat);
    }
    if (to.pUnk) to.pUnk->AddRef();
    return S_OK;
}
LONG FrameBytes(const VideoFormat& format) {
    return format.width * format.height * (format.nv12 ? 3 : 8) / 2;
}
VideoFormat FormatAt(int index) {
    const LONG sizes[][2] = {{1920, 1080}, {1080, 1920}, {1280, 720}, {720, 1280}};
    return {sizes[(index / 2) % 4][0], sizes[(index / 2) % 4][1], index % 2 == 0};
}
HRESULT MakeMediaType(const VideoFormat& format, AM_MEDIA_TYPE& type) {
    type = {};
    auto* info = static_cast<VIDEOINFOHEADER*>(CoTaskMemAlloc(sizeof(VIDEOINFOHEADER)));
    if (!info) return E_OUTOFMEMORY;
    *info = {};
    info->AvgTimePerFrame = 10000000 / 30;
    info->dwBitRate = FrameBytes(format) * 8 * 30;
    info->bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info->bmiHeader.biWidth = format.width; info->bmiHeader.biHeight = format.height;
    info->bmiHeader.biPlanes = 1; info->bmiHeader.biBitCount = format.nv12 ? 12 : 32;
    info->bmiHeader.biCompression = format.nv12 ? 0x3231564e : BI_RGB;
    info->bmiHeader.biSizeImage = FrameBytes(format);
    type.majortype = MEDIATYPE_Video; type.subtype = format.nv12 ? kNv12 : MEDIASUBTYPE_RGB32;
    type.bFixedSizeSamples = TRUE; type.bTemporalCompression = FALSE;
    type.lSampleSize = FrameBytes(format); type.formattype = FORMAT_VideoInfo;
    type.cbFormat = sizeof(VIDEOINFOHEADER); type.pbFormat = reinterpret_cast<BYTE*>(info);
    return S_OK;
}
HRESULT ParseMediaType(const AM_MEDIA_TYPE& type, VideoFormat& format) {
    if (type.majortype != MEDIATYPE_Video || !type.pbFormat) return VFW_E_TYPE_NOT_ACCEPTED;
    const BITMAPINFOHEADER* header = nullptr;
    REFERENCE_TIME interval = 0;
    if (type.formattype == FORMAT_VideoInfo && type.cbFormat >= sizeof(VIDEOINFOHEADER)) {
        auto* info = reinterpret_cast<const VIDEOINFOHEADER*>(type.pbFormat);
        header = &info->bmiHeader; interval = info->AvgTimePerFrame;
    } else if (type.formattype == FORMAT_VideoInfo2 && type.cbFormat >= sizeof(VIDEOINFOHEADER2)) {
        auto* info = reinterpret_cast<const VIDEOINFOHEADER2*>(type.pbFormat);
        header = &info->bmiHeader; interval = info->AvgTimePerFrame;
    }
    if (!header || !SupportedSize(header->biWidth, header->biHeight) || header->biPlanes != 1
        || header->biSize != sizeof(BITMAPINFOHEADER) || (interval && (interval < 333000 || interval > 334000)))
        return VFW_E_TYPE_NOT_ACCEPTED;
    const bool nv12 = type.subtype == kNv12;
    if (!nv12 && type.subtype != MEDIASUBTYPE_RGB32) return VFW_E_TYPE_NOT_ACCEPTED;
    if (header->biBitCount != (nv12 ? 12 : 32) || header->biCompression != (nv12 ? DWORD(0x3231564e) : DWORD(BI_RGB)))
        return VFW_E_TYPE_NOT_ACCEPTED;
    format = {header->biWidth, header->biHeight, nv12};
    return S_OK;
}

namespace {
struct Pixel { int b, g, r; };
struct Scaler {
    const FrameSnapshot* frame;
    int left = 0, top = 0, width = 0, height = 0;
    Scaler(const FrameSnapshot* source, const VideoFormat& format) : frame(source) {
        if (!frame) return;
        const double scale = std::min(double(format.width) / frame->width, double(format.height) / frame->height);
        width = std::max(1, static_cast<int>(frame->width * scale));
        height = std::max(1, static_cast<int>(frame->height * scale));
        left = (format.width - width) / 2; top = (format.height - height) / 2;
    }
    Pixel At(int x, int y) const {
        if (!frame || x < left || y < top || x >= left + width || y >= top + height) return {0, 0, 0};
        const int sx = (x - left) * frame->width / width, sy = (y - top) * frame->height / height;
        const uint8_t* pixel = frame->pixels.data() + (static_cast<size_t>(sy) * frame->width + sx) * 4;
        return {pixel[0], pixel[1], pixel[2]};
    }
};
BYTE Clamp(int value) { return static_cast<BYTE>(std::clamp(value, 0, 255)); }
}
void DrawFrame(const FrameSnapshot* frame, const VideoFormat& format, BYTE* output) {
    const Scaler scaler(frame, format);
    const int width = format.width, height = format.height;
    if (!format.nv12) {
        for (int y = 0; y < height; ++y) {
            BYTE* row = output + static_cast<size_t>(height - y - 1) * width * 4;
            if (frame && frame->width == static_cast<uint32_t>(width) && frame->height == static_cast<uint32_t>(height)) {
                std::memcpy(row, frame->pixels.data() + static_cast<size_t>(y) * width * 4, width * 4);
                continue;
            }
            for (int x = 0; x < width; ++x) {
                const auto pixel = scaler.At(x, y);
                row[x * 4] = BYTE(pixel.b); row[x * 4 + 1] = BYTE(pixel.g);
                row[x * 4 + 2] = BYTE(pixel.r); row[x * 4 + 3] = 255;
            }
        }
        return;
    }
    BYTE* chroma = output + static_cast<size_t>(width) * height;
    // BT.709 limited range. A 2x2 box average avoids colored edges in 4:2:0 chroma.
    for (int y = 0; y < height; y += 2) {
        for (int x = 0; x < width; x += 2) {
            int r = 0, g = 0, b = 0;
            for (int dy = 0; dy < 2; ++dy) for (int dx = 0; dx < 2; ++dx) {
                const auto pixel = scaler.At(x + dx, y + dy);
                r += pixel.r; g += pixel.g; b += pixel.b;
                output[(y + dy) * width + x + dx] = Clamp(((47 * pixel.r + 157 * pixel.g + 16 * pixel.b + 128) >> 8) + 16);
            }
            r /= 4; g /= 4; b /= 4;
            chroma[(y / 2) * width + x] = Clamp(((-26 * r - 86 * g + 112 * b + 128) >> 8) + 128);
            chroma[(y / 2) * width + x + 1] = Clamp(((112 * r - 102 * g - 10 * b + 128) >> 8) + 128);
        }
    }
}
}
