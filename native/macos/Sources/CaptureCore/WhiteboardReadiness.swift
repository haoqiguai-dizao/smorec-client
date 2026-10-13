import Foundation

/// WindowServer may publish a newly shown whiteboard after the first catalogue read.
public enum WhiteboardReadiness {
    public static func wait<Value>(attempts: Int = 8,
        pause: () async throws -> Void = { try await Task.sleep(for: .milliseconds(100)) },
        read: () async throws -> Value?) async throws -> Value {
        for attempt in 0..<max(1, attempts) {
            try Task.checkCancellation()
            if let value = try await read() { return value }
            if attempt + 1 < attempts { try await pause() }
        }
        throw CaptureFailure("白板窗口尚未就绪，请重新打开白板")
    }
}
