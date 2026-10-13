import AVFoundation
import ScreenCaptureKit
import CaptureCore

/// ScreenCaptureKit can letterbox single-window frames even with preservesAspectRatio disabled.
/// Persist only geometry changes, at the encoded frame's clock, so resize does not stretch UI.
final class WhiteboardGeometry {
    private let file: FileHandle
    private let origin: CMTime
    private var previous: CGRect?
    private var count = 0
    init(directory: URL, origin: CMTime) throws {
        self.origin = origin
        let url = directory.appendingPathComponent("whiteboard-frames.jsonl")
        FileManager.default.createFile(atPath: url.path, contents: nil)
        file = try FileHandle(forWritingTo: url)
    }
    func append(_ info: [SCStreamFrameInfo: Any], sample: CMSampleBuffer) throws {
        guard let dictionary = info[.contentRect] as? [String: Any],
              let content = CGRect(dictionaryRepresentation: dictionary as CFDictionary),
              let image = sample.imageBuffer, let scale = info[.scaleFactor] as? Double else {
            throw CaptureFailure("白板画面缺少有效窗口区域")
        }
        let width = Double(CVPixelBufferGetWidth(image)), height = Double(CVPixelBufferGetHeight(image))
        let rect = CGRect(x: content.minX * scale / width, y: content.minY * scale / height,
                          width: content.width * scale / width, height: content.height * scale / height)
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard !rect.isNull, rect.width > 0, rect.height > 0 else { throw CaptureFailure("白板窗口区域为空") }
        guard rect != previous else { return }
        guard count < 20_000 else { throw CaptureFailure("白板窗口尺寸变化已达容量，请开始新的录制") }
        let record: [String: Any] = ["t": max(0, CMTimeSubtract(sample.presentationTimeStamp, origin).seconds),
            "bounds": ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]]
        var data = try JSONSerialization.data(withJSONObject: record); data.append(10)
        try file.write(contentsOf: data)
        previous = rect; count += 1
    }
    func close() throws { try file.synchronize(); try file.close() }
    deinit { try? file.close() }
}
