import Foundation

public struct CaptureFailure: LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

public struct CaptureRect: Codable, Equatable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
}

public struct CaptureOptions: Decodable {
    public var sourceId: String
    public var systemAudio: Bool
    public var microphone: Bool
    public var inputRecording: Bool?
    public var fps: Int
    public var crop: CaptureRect?
    public var microphoneDeviceId: String?
    public var liveAudio: Bool?
    public var resolution: String?
    public var excludedApplications: [String]?
    public var captureOwnApp: Bool?
    public var ownAppVisible: Bool?

    public func dimensions(sourceWidth: Int, sourceHeight: Int) throws -> (Int, Int) {
        guard [30, 60].contains(fps), sourceWidth >= 32, sourceHeight >= 32,
              sourceWidth <= 32768, sourceHeight <= 32768 else {
            throw CaptureFailure("录制来源或帧率无效")
        }
        let rect = crop ?? CaptureRect(x: 0, y: 0, width: Double(sourceWidth), height: Double(sourceHeight))
        guard [rect.x, rect.y, rect.width, rect.height].allSatisfy({ $0.isFinite && $0.rounded() == $0 }),
              rect.x >= 0, rect.y >= 0, rect.width >= 32, rect.height >= 32,
              rect.x + rect.width <= Double(sourceWidth), rect.y + rect.height <= Double(sourceHeight) else {
            throw CaptureFailure("录制区域超出来源边界")
        }
        let limits = ["native": 32768.0, "2160p": 3840, "1440p": 2560, "1080p": 1920]
        guard let limit = limits[resolution ?? "native"] else { throw CaptureFailure("录制分辨率无效") }
        let evenWidth = floor(rect.width / 2) * 2, evenHeight = floor(rect.height / 2) * 2
        let scale = min(1, limit / max(evenWidth, evenHeight))
        let width = Int(evenWidth * scale) / 2 * 2, height = Int(evenHeight * scale) / 2 * 2
        guard width <= 8192, height <= 8192, width * height <= 33_177_600 else { throw CaptureFailure("来源超过编码上限，请选择 4K 或更低分辨率") }
        return (width, height)
    }
}

public struct CaptureSource: Codable {
    public let id: String
    public let kind: String
    public let name: String
    public let width: Int
    public let height: Int
    public let bounds: CaptureRect
    public init(id: String, kind: String, name: String, width: Int, height: Int, bounds: CaptureRect) {
        self.id = id; self.kind = kind; self.name = name
        self.width = width; self.height = height; self.bounds = bounds
    }
}

public struct CursorSample: Codable {
    public let t: Double
    public let x: Double
    public let y: Double
    public let visible: Bool
    public let click: Bool
    public let shape: String
    public init(t: Double, x: Double, y: Double, visible: Bool, click: Bool, shape: String) {
        self.t = t; self.x = x; self.y = y; self.visible = visible; self.click = click; self.shape = shape
    }
}

public func validatedApplicationIDs(_ ids: [String]) throws -> [String] {
    guard ids.count <= 32, ids.allSatisfy({ id in
        id.count <= 255 && id.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]*(\\.[A-Za-z0-9_-]+)+$", options: .regularExpression) != nil
    }) else { throw CaptureFailure("排除应用标识无效") }
    return Array(Set(ids)).sorted()
}

/// Enabled operation recording must never silently fall back to incomplete activity.
public func requireInputRecordingAccess(enabled: Bool, inputAllowed: Bool, accessibilityAllowed: Bool) throws {
    guard enabled else { return }
    var missing: [String] = []
    if !inputAllowed { missing.append("输入监控") }
    if !accessibilityAllowed { missing.append("辅助功能") }
    guard missing.isEmpty else {
        throw CaptureFailure("记录点击与输入需要\(missing.joined(separator: "、"))权限，请先在系统设置 → 隐私与安全性中允许小录，或选择仅录画面与声音")
    }
}

/// Only source-relative physical pixels are written into the cross-platform journal.
public func normalizedPoint(x: Double, y: Double, bounds: CaptureRect, crop: CaptureRect?, scale: Double) -> (Double, Double, Bool) {
    let rect = crop ?? CaptureRect(x: 0, y: 0, width: bounds.width * scale, height: bounds.height * scale)
    guard scale.isFinite, scale > 0, rect.width > 0, rect.height > 0 else { return (0, 0, false) }
    let px = ((x - bounds.x) * scale - rect.x) / rect.width
    let py = ((y - bounds.y) * scale - rect.y) / rect.height
    return (min(1, max(0, px)), min(1, max(0, py)), px >= 0 && px <= 1 && py >= 0 && py <= 1)
}
