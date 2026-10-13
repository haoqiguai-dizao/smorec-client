import Foundation
import CoreVideo

/// IOSurface 池有硬上限；接收方滞留旧帧时丢弃当前输出，避免直播内存随时长增长。
public final class CameraFramePool {
    private let pool: CVPixelBufferPool
    private let maximum: Int
    public init(format: CameraFormat, maximum: Int = 6) throws {
        self.maximum = maximum
        var value: CVPixelBufferPool?
        try cameraCheck(CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, [
            kCVPixelBufferWidthKey: format.width, kCVPixelBufferHeightKey: format.height,
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey: [:]
        ] as CFDictionary, &value), "创建摄像头缓冲池")
        guard let value else { throw CameraError("摄像头缓冲池不可用") }
        pool = value
    }
    public func next() throws -> CVPixelBuffer {
        var value: CVPixelBuffer?
        try cameraCheck(CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool,
            [kCVPixelBufferPoolAllocationThresholdKey: maximum] as CFDictionary, &value), "分配摄像头缓冲")
        guard let value else { throw CameraError("摄像头缓冲暂不可用") }
        return value
    }
}
