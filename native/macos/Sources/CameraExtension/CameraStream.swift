import Foundation
import CoreMediaIO
import CameraCore

final class CameraStream: NSObject, CMIOExtensionStreamSource {
    private(set) var stream: CMIOExtensionStream!
    unowned let camera: CameraDevice
    let sink: Bool
    let formats: [CMIOExtensionStreamFormat]
    var activeIndex = 0
    var client: CMIOExtensionClient?
    var starts = 0
    init(camera: CameraDevice, sink: Bool) throws {
        self.camera = camera; self.sink = sink
        formats = try CameraFormat.all.map { format in
            CMIOExtensionStreamFormat(formatDescription: try format.description(), maxFrameDuration: format.duration,
                minFrameDuration: format.duration, validFrameDurations: nil)
        }
        super.init()
        stream = CMIOExtensionStream(localizedName: sink ? "小录输入" : CameraIdentity.name,
            streamID: sink ? CameraIdentity.sinkID : CameraIdentity.sourceID,
            direction: sink ? .sink : .source, clockType: .hostTime, source: self)
    }
    var availableProperties: Set<CMIOExtensionProperty> {
        var properties: Set<CMIOExtensionProperty> = [.streamActiveFormatIndex, .streamFrameDuration]
        if sink { properties.formUnion([.streamSinkBufferQueueSize, .streamSinkBuffersRequiredForStartup]) }
        return properties
    }
    func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let result = CMIOExtensionStreamProperties(dictionary: [:])
        if properties.contains(.streamActiveFormatIndex) { result.activeFormatIndex = activeIndex }
        if properties.contains(.streamFrameDuration) { result.frameDuration = CameraFormat.all[activeIndex].duration }
        if sink {
            if properties.contains(.streamSinkBufferQueueSize) { result.sinkBufferQueueSize = 3 }
            if properties.contains(.streamSinkBuffersRequiredForStartup) { result.sinkBuffersRequiredForStartup = 1 }
        }
        return result
    }
    func setStreamProperties(_ properties: CMIOExtensionStreamProperties) throws {
        if let duration = properties.frameDuration, duration != CameraFormat.all[0].duration { throw CameraError("摄像头帧率固定为 30 FPS") }
        if let index = properties.activeFormatIndex {
            guard formats.indices.contains(index) else { throw CameraError("摄像头格式索引无效") }
            activeIndex = index
            camera.clear()
        }
    }
    func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool {
        guard sink else { return true } // 接收方的摄像头权限由系统确认。
        guard self.client == nil || self.client?.clientID == client.clientID,
              camera.authorizedProducer(client) else { return false }
        self.client = client
        return true
    }
    func startStream() throws {
        if sink && client == nil { throw CameraError("直播输入尚未授权") }
        starts += 1; camera.updateTimer()
    }
    func stopStream() throws {
        starts = max(0, starts - 1)
        if sink && starts == 0 { client = nil; camera.clear() }
        camera.updateTimer()
    }
}
