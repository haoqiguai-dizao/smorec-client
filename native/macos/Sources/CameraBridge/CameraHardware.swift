import Foundation
import CoreMediaIO
import CameraCore

struct CameraHardware {
    let device: CMIODeviceID
    let sink: CMIOStreamID
    let sources: [CMIOStreamID]
    static func address(_ selector: Int, scope: Int = kCMIOObjectPropertyScopeGlobal) -> CMIOObjectPropertyAddress {
        CMIOObjectPropertyAddress(mSelector: UInt32(selector), mScope: UInt32(scope), mElement: UInt32(kCMIOObjectPropertyElementMain))
    }
    static func ids(_ id: CMIOObjectID, _ selector: Int, scope: Int = kCMIOObjectPropertyScopeGlobal) throws -> [UInt32] {
        var property = address(selector, scope: scope), size: UInt32 = 0, used: UInt32 = 0
        try cameraCheck(CMIOObjectGetPropertyDataSize(id, &property, 0, nil, &size), "读取摄像头列表长度")
        guard size <= 65536, size % 4 == 0 else { throw CameraError("摄像头列表无效") }
        if size == 0 { return [] }
        var values = [UInt32](repeating: 0, count: Int(size / 4))
        try values.withUnsafeMutableBytes { bytes in
            try cameraCheck(CMIOObjectGetPropertyData(id, &property, 0, nil, size, &used, bytes.baseAddress!), "读取摄像头列表")
        }
        guard used <= size, used % 4 == 0 else { throw CameraError("摄像头列表长度变化，请重试") }
        return Array(values.prefix(Int(used / 4)))
    }
    static func text(_ id: CMIOObjectID, _ selector: Int) throws -> String {
        var property = address(selector), value: Unmanaged<CFString>?, used: UInt32 = 0
        try cameraCheck(CMIOObjectGetPropertyData(id, &property, 0, nil, UInt32(MemoryLayout<Unmanaged<CFString>?>.size), &used, &value), "读取摄像头标识")
        guard let value else { throw CameraError("摄像头标识为空") }
        return value.takeRetainedValue() as String
    }
    static func find() throws -> CameraHardware? {
        var property = address(kCMIOHardwarePropertyAllowScreenCaptureDevices), allow: UInt32 = 1
        try cameraCheck(CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &property, 0, nil, 4, &allow), "枚举虚拟摄像头")
        for id in try ids(CMIOObjectID(kCMIOObjectSystemObject), kCMIOHardwarePropertyDevices) {
            guard try text(id, kCMIODevicePropertyDeviceUID) == CameraIdentity.legacyID else { continue }
            let outputs = try ids(id, kCMIODevicePropertyStreams, scope: kCMIODevicePropertyScopeOutput)
            let inputs = try ids(id, kCMIODevicePropertyStreams, scope: kCMIODevicePropertyScopeInput)
            guard outputs.count == 1, !inputs.isEmpty else { throw CameraError("虚拟摄像头协议版本不兼容，请更新组件") }
            return CameraHardware(device: id, sink: outputs[0], sources: inputs)
        }
        return nil
    }
    func configure(_ format: CameraFormat) throws {
        let description = try format.description()
        var pointer = Unmanaged.passUnretained(description).toOpaque()
        var property = Self.address(kCMIOStreamPropertyFormatDescription)
        try cameraCheck(CMIOObjectSetPropertyData(sink, &property, 0, nil, UInt32(MemoryLayout<UnsafeMutableRawPointer>.size), &pointer), "设置直播输入格式")
        defer { withExtendedLifetime(description) {} }
        for source in sources {
            // 接收软件已经占用格式时保留它；扩展按比例适配画面，不裁掉内容。
            _ = CMIOObjectSetPropertyData(source, &property, 0, nil, UInt32(MemoryLayout<UnsafeMutableRawPointer>.size), &pointer)
        }
    }
}
