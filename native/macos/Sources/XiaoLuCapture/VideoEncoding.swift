import AVFoundation
import VideoToolbox
import CaptureCore

enum VideoEncoding {
    /// H.264 hardware has a smaller size limit than HEVC on some Apple Silicon Macs.
    /// Probe the actual dimensions; enabling acceleration alone permits silent CPU fallback.
    static func hardwareCodec(width: Int, height: Int) throws -> AVVideoCodecType {
        for (codec, type) in [(kCMVideoCodecType_H264, AVVideoCodecType.h264),
                              (kCMVideoCodecType_HEVC, AVVideoCodecType.hevc)] {
            var session: VTCompressionSession?
            let specification = [kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder: true] as CFDictionary
            let status = VTCompressionSessionCreate(allocator: kCFAllocatorDefault,
                width: Int32(width), height: Int32(height), codecType: codec,
                encoderSpecification: specification, imageBufferAttributes: nil,
                compressedDataAllocator: nil, outputCallback: nil, refcon: nil,
                compressionSessionOut: &session)
            if let session { VTCompressionSessionInvalidate(session) }
            if status == noErr { return type }
        }
        throw CaptureFailure("当前尺寸无法使用硬件编码，请在录制设置选择较低分辨率后重试")
    }
}
