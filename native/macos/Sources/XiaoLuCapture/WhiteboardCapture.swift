import AVFoundation
import ScreenCaptureKit
import CaptureCore

/// A window-only hardware track: controls, popovers and transient gestures are real UI pixels.
/// Fixed output dimensions survive resize; layout events restore the window's actual aspect ratio.
final class WhiteboardCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let queue = DispatchQueue(label: "smorec.whiteboard", qos: .userInitiated)
    private let directory: URL
    private let screenOrigin: CMTime
    private var stream: SCStream?
    private var video: VideoTrack?
    private var ready = false
    private var ending = false
    private var failure: Error?
    private var geometry: WhiteboardGeometry?
    private var configuration: SCStreamConfiguration?
    private var activeFPS = 30
    // ScreenCaptureKit's assign property does not retain the CGColor.
    private let captureBackground = CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)

    init(directory: URL, screenOrigin: CMTime) {
        self.directory = directory; self.screenOrigin = screenOrigin
    }

    func start(windowID: CGWindowID, width: Int, height: Int, fps: Int) async throws {
        let content = try await SourceCatalog.content(includingWhiteboardID: windowID)
        guard let window = content.windows.first(where: { $0.windowID == windowID }),
              window.owningApplication?.processID == SourceCatalog.parentPID else {
            throw CaptureFailure("白板窗口尚未就绪，请重新打开白板")
        }
        let config = SCStreamConfiguration()
        config.width = width; config.height = height
        config.minimumFrameInterval = CMTime(value: 1, timescale: Int32(fps))
        config.queueDepth = 3; config.showsCursor = true
        config.scalesToFit = true; config.preservesAspectRatio = false
        config.ignoreShadowsSingleWindow = true
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.captureDynamicRange = .SDR
        // Transparency is a local writing aid. Recorded interface pixels stay opaque.
        config.backgroundColor = captureBackground
        config.capturesAudio = false; config.captureMicrophone = false
        configuration = config; activeFPS = fps
        do {
            geometry = try WhiteboardGeometry(directory: directory, origin: screenOrigin)
            video = try VideoTrack(url: directory.appendingPathComponent("whiteboard.mp4"), width: width, height: height, fps: fps)
            let stream = SCStream(filter: SCContentFilter(desktopIndependentWindow: window), configuration: config, delegate: self)
            self.stream = stream
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            try await stream.startCapture()
            let deadline = ContinuousClock.now + .seconds(8)
            while ContinuousClock.now < deadline {
                let state = queue.sync { (ready, failure) }
                if let error = state.1 { throw error }
                if state.0 { return }
                try await Task.sleep(for: .milliseconds(20))
            }
            throw CaptureFailure("白板画面采集超时，请重试")
        } catch {
            queue.sync { ending = true }
            if let stream { try? await stream.stopCapture() }
            queue.sync { video?.cancel() }
            self.stream = nil
            geometry = nil
            for file in ["whiteboard.mp4", "whiteboard-video.json", "whiteboard-frames.jsonl"] {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent(file))
            }
            throw error
        }
    }

    func setActive(_ active: Bool) async throws {
        guard let stream, let configuration else { return }
        // Preserve one continuous file across mode switches; invisible intervals need no detail.
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: Int32(active ? activeFPS : 1))
        try await stream.updateConfiguration(configuration)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !ending, sample.isValid, type == .screen,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              attachments.first?[.status] as? Int == SCFrameStatus.complete.rawValue else { return }
        do {
            if try video?.append(sample) == true {
                try geometry?.append(attachments[0], sample: sample)
                guard !ready else { return }
                let offset = -max(0, CMTimeSubtract(sample.presentationTimeStamp, screenOrigin).seconds)
                try JSONSerialization.data(withJSONObject: ["offset": offset]).write(
                    to: directory.appendingPathComponent("whiteboard-video.json"), options: .atomic)
                ready = true
            }
        } catch { failed(error) }
    }

    private func failed(_ error: Error) {
        guard failure == nil, !ending else { return }
        failure = error
        // Before activation the caller can retry; after activation stop rather than lose UI silently.
        if ready { Wire.send(["event": "state", "state": ["status": "error", "error": "白板界面采集中断：\(error.localizedDescription)"]]) }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { queue.async { self.failed(error) } }

    func finish(at end: CMTime) async throws -> [String] {
        queue.sync { ending = true }
        if let stream { try? await stream.stopCapture() }
        self.stream = nil
        guard let video else { return [] }
        _ = try await video.finish(at: end)
        try geometry?.close(); geometry = nil
        var warnings = queue.sync { failure.map { ["白板界面采集异常：\($0.localizedDescription)"] } ?? [] }
        if video.dropped > 0 { warnings.append("白板界面编码繁忙期间跳过 \(video.dropped) 帧，原始时间戳已保留") }
        return warnings
    }
}
