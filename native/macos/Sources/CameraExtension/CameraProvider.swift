import Foundation
import CoreMediaIO
import CameraCore

// 按 Apple Xcode Camera Extension 模板划分 provider、device、stream 职责。
final class CameraProvider: NSObject, CMIOExtensionProviderSource {
    let queue = DispatchQueue(label: "studio.frameflow.camera", qos: .userInteractive)
    private(set) var provider: CMIOExtensionProvider!
    private var camera: CameraDevice!
    override init() {
        super.init()
        provider = CMIOExtensionProvider(source: self, clientQueue: queue)
        do {
            camera = try CameraDevice(queue: queue)
            try provider.addDevice(camera.device)
        } catch { fatalError("无法初始化虚拟摄像头：\(error)") }
    }
    func connect(to client: CMIOExtensionClient) throws {}
    func disconnect(from client: CMIOExtensionClient) { camera.disconnect(client) }
    var availableProperties: Set<CMIOExtensionProperty> { [.providerManufacturer] }
    func providerProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionProviderProperties {
        let result = CMIOExtensionProviderProperties(dictionary: [:])
        if properties.contains(.providerManufacturer) { result.manufacturer = "小录" }
        return result
    }
    func setProviderProperties(_ properties: CMIOExtensionProviderProperties) throws {}
}
