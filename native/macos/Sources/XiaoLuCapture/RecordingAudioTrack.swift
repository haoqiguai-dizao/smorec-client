import AVFoundation
import CaptureCore

/// Capture callbacks only retain/enqueue samples. Conversion, checkpoints and
/// disk synchronization run on a separate bounded writer queue.
final class RecordingAudioTrack: @unchecked Sendable {
    private let writer: AudioTrack
    private let queue: DispatchQueue
    private let lock = NSLock()
    private var queuedSeconds = 0.0
    private var failure: Error?
    private var hasReceived = false
    private var closing = false
    private var isMuted = false
    var onFailure: ((Error) -> Void)?

    init(url: URL, onLevel: ((Double) -> Void)? = nil, queue: DispatchQueue? = nil) throws {
        writer = try AudioTrack(url: url, onLevel: onLevel)
        self.queue = queue ?? DispatchQueue(label: "smorec.audio-write.\(UUID())", qos: .utility)
    }

    var received: Bool { lock.withLock { hasReceived } }
    var muted: Bool {
        get { lock.withLock { isMuted } }
        set { lock.withLock { isMuted = newValue } }
    }

    func append(_ sample: CMSampleBuffer, origin: CMTime) throws {
        guard let description = sample.formatDescription,
              let format = CMAudioFormatDescriptionGetStreamBasicDescription(description),
              format.pointee.mSampleRate.isFinite, format.pointee.mSampleRate > 0 else {
            throw CaptureFailure("声音采集格式无效")
        }
        let seconds = Double(CMSampleBufferGetNumSamples(sample)) / format.pointee.mSampleRate
        let muted = try lock.withLock {
            if let failure { throw failure }
            guard !closing else { throw CaptureFailure("声音原片正在结束") }
            guard seconds > 0, seconds <= 2, queuedSeconds + seconds <= 2.0001 else {
                throw CaptureFailure("声音原片写入持续跟不上采集，已停止并保留现有素材")
            }
            queuedSeconds += seconds
            return isMuted
        }
        // CMSampleBuffer is retained by this closure until the writer is done.
        queue.async { [self] in
            defer { lock.withLock { queuedSeconds = max(0, queuedSeconds - seconds) } }
            if lock.withLock({ failure != nil }) { return }
            do {
                writer.muted = muted
                try writer.append(sample, origin: origin)
                lock.withLock { hasReceived = writer.received }
            } catch {
                lock.withLock { failure = error }
                onFailure?(error)
            }
        }
    }

    /// Call only after stopping sample delivery. FIFO completion drains accepted
    /// audio before closing the recoverable WAV and reporting its final state.
    func finish(duration: Double) async throws {
        lock.withLock { closing = true }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async { [self] in
                do {
                    try writer.finish(duration: duration)
                    if let failure = lock.withLock({ failure }) { throw failure }
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }
    func align(to time: Double) {
        queue.async { [self] in
            do { try writer.align(to: time) }
            catch { lock.withLock { failure = error }; onFailure?(error) }
        }
    }
}
