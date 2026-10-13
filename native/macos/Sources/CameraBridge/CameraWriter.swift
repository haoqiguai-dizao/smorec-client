import Foundation
import CoreMediaIO
import CameraCore

final class CameraWriter {
    private let camera: CameraHardware
    private let format: CameraFormat
    private let pool: CameraFramePool
    private var buffers: CMSimpleQueue?
    private var started = false
    init(format: CameraFormat) throws {
        guard let camera = try CameraHardware.find() else { throw CameraError("尚未安装或启用小录虚拟摄像头") }
        self.camera = camera; self.format = format
        pool = try CameraFramePool(format: format)
        try camera.configure(format)
        var queue: Unmanaged<CMSimpleQueue>?
        try cameraCheck(CMIOStreamCopyBufferQueue(camera.sink, nil, nil, &queue), "连接虚拟摄像头输入队列")
        guard let queue else { throw CameraError("虚拟摄像头输入队列不可用") }
        buffers = queue.takeRetainedValue()
        try cameraCheck(CMIODeviceStartStream(camera.device, camera.sink), "启动虚拟摄像头")
        started = true
    }
    func run() throws {
        bridgeJSON(["event": "ready", "width": format.width, "height": format.height, "fps": CameraFormat.fps, "pixelFormat": "BGRA"])
        while true {
            var data = Data(capacity: format.frameBytes)
            while data.count < format.frameBytes {
                guard let part = try FileHandle.standardInput.read(upToCount: format.frameBytes - data.count), !part.isEmpty else {
                    if data.isEmpty { return }
                    throw CameraError("直播帧尚未读完整，输入已关闭")
                }
                data.append(part)
            }
            try autoreleasepool {
                guard let buffers else { throw CameraError("摄像头输入队列已结束") }
                let deadline = ProcessInfo.processInfo.systemUptime + 2
                while CMSimpleQueueGetCount(buffers) >= CMSimpleQueueGetCapacity(buffers) {
                    if ProcessInfo.processInfo.systemUptime > deadline { throw CameraError("虚拟摄像头停止接收画面") }
                    Thread.sleep(forTimeInterval: 0.002)
                }
                let pixels = try pool.next()
                try format.copy(data, to: pixels)
                let sample = try format.sample(pixels, at: CMClockGetTime(CMClockGetHostTimeClock()))
                let pointer = Unmanaged.passRetained(sample).toOpaque()
                let result = CMSimpleQueueEnqueue(buffers, element: pointer)
                if result != noErr { Unmanaged<CMSampleBuffer>.fromOpaque(pointer).release() }
                try cameraCheck(result, "写入虚拟摄像头")
            }
        }
    }
    deinit {
        if started { _ = CMIODeviceStopStream(camera.device, camera.sink) }
        // 停止后回收尚未交给 CMIO 的缓冲；消费中的缓冲由系统持有。
        if let buffers {
            while let pointer = CMSimpleQueueDequeue(buffers) { Unmanaged<CMSampleBuffer>.fromOpaque(pointer).release() }
        }
    }
}
