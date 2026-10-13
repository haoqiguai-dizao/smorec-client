import CoreMedia
import CaptureCore

protocol MicrophoneInputCapture {
    func start() async throws
    func stop() async
}
extension HALMicrophoneCapture: MicrophoneInputCapture {}

/// The selected device must deliver samples before the old input is retired.
final class PreparedMicrophoneInput: @unchecked Sendable {
    private let queue: DispatchQueue
    private var input: MicrophoneInputCapture!
    private var samples = 0
    private var failure: Error?
    private var committed = false
    private var retired = false

    init(deviceID: String?, queue: DispatchQueue, receive: @escaping (CMSampleBuffer) -> Void,
         fail: @escaping (Error) -> Void,
         factory: ((@escaping (CMSampleBuffer) -> Void, @escaping (Error) -> Void) -> MicrophoneInputCapture)? = nil) {
        self.queue = queue
        let receiveSample: (CMSampleBuffer) -> Void = { [weak self] sample in
            guard let self, !self.retired, sample.isValid, sample.numSamples > 0 else { return }
            if self.committed { receive(sample) } else { self.samples += 1 }
        }
        let inputFailed: (Error) -> Void = { [weak self] error in
            guard let self, !self.retired else { return }
            if self.committed { fail(error) } else { self.failure = error }
        }
        input = factory?(receiveSample, inputFailed)
            ?? HALMicrophoneCapture(deviceID: deviceID, delivery: queue, receive: receiveSample, fail: inputFailed)
    }

    func prepare() async throws {
        do {
            try await input.start()
            for _ in 0..<50 {
                let result = queue.sync { (samples >= 2, failure, retired) }
                if let error = result.1 { throw error }
                if result.2 { throw CaptureFailure("麦克风切换已取消") }
                if result.0 { return }
                try await Task.sleep(for: .milliseconds(100))
            }
            throw CaptureFailure("所选麦克风没有送来声音，原设备保持")
        } catch { await stop(); throw error }
    }
    /// Called by the session on its capture queue, after aligning the existing WAV.
    func commit() throws {
        if let failure { throw failure }
        guard !retired, samples >= 2 else { throw CaptureFailure("麦克风切换已取消，原设备保持") }
        committed = true
    }
    func stop() async {
        queue.sync { retired = true }
        await input.stop()
    }
}
