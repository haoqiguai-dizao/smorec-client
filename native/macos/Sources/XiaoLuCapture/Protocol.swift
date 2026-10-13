import Foundation
import CaptureCore

struct Command: Decodable {
    let id: String
    let command: String
    let options: CaptureOptions?
    let directory: String?
    let deviceId: String?
    let pipeName: String?
    let excludedApplications: [String]?
}

enum Wire {
    private static let lock = NSLock()
    static func send(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]) else { return }
        lock.lock(); defer { lock.unlock() }
        do { try FileHandle.standardOutput.write(contentsOf: data + Data([10])) }
        catch { /* EOF is handled by the main loop; never mix diagnostics with stdout. */ }
    }
    static func object<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }
    static func write<T: Encodable>(_ value: T, to url: URL) throws {
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
    }
    static func diagnostic(_ message: String) {
        try? FileHandle.standardError.write(contentsOf: Data((message + "\n").utf8))
    }
    static func directory(_ value: String?) throws -> URL {
        guard let value, value.hasPrefix("/"), !value.contains("\0") else { throw CaptureFailure("输出目录无效") }
        let url = URL(fileURLWithPath: value, isDirectory: true).standardizedFileURL
        guard url.path == url.resolvingSymlinksInPath().path,
              try url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory == true else {
            throw CaptureFailure("输出必须使用已创建的本地目录")
        }
        return url
    }
}
