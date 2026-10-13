import Foundation
import CoreMedia
import CoreVideo

public enum CameraIdentity {
    public static let name = "小录 Virtual Camera"
    public static let extensionID = "studio.frameflow.desktop.camera-extension"
    public static let bridgeID = "studio.frameflow.camera-bridge"
    public static let deviceID = UUID(uuidString: "81C44D8B-795D-48B5-90A4-ED5EA16C3001")!
    public static let sourceID = UUID(uuidString: "81C44D8B-795D-48B5-90A4-ED5EA16C3002")!
    public static let sinkID = UUID(uuidString: "81C44D8B-795D-48B5-90A4-ED5EA16C3003")!
    public static let legacyID = "studio.frameflow.virtual-camera.v1"
}

public struct CameraFormat: Equatable {
    public let width: Int
    public let height: Int
    public static let fps: Int32 = 30
    public static let all = [CameraFormat(width: 1920, height: 1080), CameraFormat(width: 1080, height: 1920)]
    public var frameBytes: Int { width * height * 4 }
    public var duration: CMTime { CMTime(value: 1, timescale: Self.fps) }
    public static func matching(width: Int, height: Int, fps: Int) throws -> CameraFormat {
        guard fps == Self.fps, let format = all.first(where: { $0.width == width && $0.height == height }) else {
            throw CameraError("虚拟摄像头仅支持横屏或竖屏 1080p · 30 FPS")
        }
        return format
    }
    public func description() throws -> CMVideoFormatDescription {
        var value: CMVideoFormatDescription?
        try cameraCheck(CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: kCVPixelFormatType_32BGRA,
            width: Int32(width), height: Int32(height), extensions: nil, formatDescriptionOut: &value), "创建摄像头格式")
        guard let value else { throw CameraError("无法创建摄像头格式") }
        return value
    }
    public func pixelBuffer() throws -> CVPixelBuffer {
        var value: CVPixelBuffer?
        try cameraCheck(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &value), "创建摄像头帧")
        guard let value else { throw CameraError("无法分配摄像头帧") }
        return value
    }
    public func sample(_ pixels: CVPixelBuffer, at time: CMTime) throws -> CMSampleBuffer {
        guard CVPixelBufferGetWidth(pixels) == width, CVPixelBufferGetHeight(pixels) == height,
              CVPixelBufferGetPixelFormatType(pixels) == kCVPixelFormatType_32BGRA else { throw CameraError("摄像头帧尺寸不匹配") }
        var timing = CMSampleTimingInfo(duration: duration, presentationTimeStamp: time, decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        try cameraCheck(CMSampleBufferCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixels, dataReady: true,
            makeDataReadyCallback: nil, refcon: nil, formatDescription: description(), sampleTiming: &timing, sampleBufferOut: &sample), "创建摄像头采样")
        guard let sample else { throw CameraError("无法创建摄像头采样") }
        return sample
    }
    public func copy(_ bytes: Data, to pixels: CVPixelBuffer) throws {
        guard bytes.count == frameBytes, CVPixelBufferGetWidth(pixels) == width,
              CVPixelBufferGetHeight(pixels) == height else { throw CameraError("摄像头帧长度无效") }
        try cameraCheck(CVPixelBufferLockBaseAddress(pixels, []), "锁定摄像头帧")
        defer { CVPixelBufferUnlockBaseAddress(pixels, []) }
        guard let base = CVPixelBufferGetBaseAddress(pixels) else { throw CameraError("摄像头帧不可写") }
        let stride = CVPixelBufferGetBytesPerRow(pixels)
        bytes.withUnsafeBytes { data in
            for y in 0..<height { memcpy(base.advanced(by: y * stride), data.baseAddress!.advanced(by: y * width * 4), width * 4) }
        }
    }
}

public struct CameraError: LocalizedError {
    public let errorDescription: String?
    public init(_ description: String) { errorDescription = description }
}
public func cameraCheck(_ status: OSStatus, _ operation: String) throws {
    if status != noErr { throw CameraError("\(operation)失败（\(status)）") }
}
