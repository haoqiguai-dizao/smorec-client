import AVFoundation
import CaptureCore

final class MicrophoneTrial: NSObject, AVCaptureAudioDataOutputSampleBufferDelegate, @unchecked Sendable {
    private let capture = AVCaptureSession()
    private var independentInput: HALMicrophoneCapture?
    private let queue = DispatchQueue(label: "smorec.microphone-trial", qos: .userInitiated)
    // Session lifecycle and sample delivery use separate serial queues to avoid stopRunning deadlocks.
    private let control = DispatchQueue(label: "smorec.microphone-session")
    private var finishTask: Task<[String: Any], Error>?
    private let track: RecordingAudioTrack
    private var origin: CMTime?
    private var last: CMTime?
    private var failure: Error?
    private var finishing = false
    private var duration: Double?
    private var timer: DispatchSourceTimer?

    private let maximumDuration: Double

    init(directory: URL, maximumDuration: Double = 10, onLevel: ((Double) -> Void)? = nil) throws {
        self.maximumDuration = maximumDuration
        track = try RecordingAudioTrack(url: directory.appendingPathComponent("microphone.wav"), onLevel: onLevel)
    }

    func start(deviceID: String?) async throws {
        track.onFailure = { [weak self] error in
            self?.queue.async { [weak self] in
                guard let self else { return }
                self.failure = error
                Task { _ = try? await self.stop() }
            }
        }
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            guard await AVCaptureDevice.requestAccess(for: .audio) else {
                throw CaptureFailure("麦克风权限未授予，请在系统设置 → 隐私与安全性 → 麦克风中允许小录")
            }
        }
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw CaptureFailure("请在系统设置 → 隐私与安全性 → 麦克风中允许小录")
        }
        if try CoreAudioInputDevice.needsIndependentInput(deviceID) {
            let input = HALMicrophoneCapture(deviceID: deviceID, delivery: queue,
                receive: { [weak self] in self?.receive($0) }, fail: { [weak self] error in
                    self?.failure = error
                    Task { _ = try? await self?.stop() }
                })
            independentInput = input
            try await input.start()
        } else { try await startAVCapture(deviceID) }
        try await waitForSamples()
    }

    private func startAVCapture(_ deviceID: String?) async throws {
        let device = try CoreAudioInputDevice.selected(deviceID)
        let input = try AVCaptureDeviceInput(device: device)
        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(self, queue: queue)
        capture.beginConfiguration()
        guard capture.canAddInput(input), capture.canAddOutput(output) else {
            capture.commitConfiguration(); throw CaptureFailure("麦克风无法开始试录")
        }
        capture.addInput(input); capture.addOutput(output); capture.commitConfiguration()
        await withCheckedContinuation { continuation in
            control.async { self.capture.startRunning(); continuation.resume() }
        }
    }

    private func waitForSamples() async throws {
        let deadline = ContinuousClock.now + .seconds(3)
        while ContinuousClock.now < deadline {
            let state = queue.sync { (origin != nil, failure) }
            if let error = state.1 { _ = try? await stop(); throw error }
            if state.0 {
                let timer = DispatchSource.makeTimerSource(queue: queue)
                timer.schedule(deadline: .now() + maximumDuration)
                timer.setEventHandler { [weak self] in Task { _ = try? await self?.stop() } }
                queue.sync { self.timer = timer; timer.resume() }
                return
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        _ = try? await stop()
        throw CaptureFailure("麦克风三秒内没有返回有效数据，请检查设备后重试")
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        receive(sampleBuffer)
    }

    private func receive(_ sampleBuffer: CMSampleBuffer) {
        guard !finishing, sampleBuffer.isValid else { return }
        do {
            if origin == nil { origin = sampleBuffer.presentationTimeStamp }
            let time = CMTimeSubtract(sampleBuffer.presentationTimeStamp, origin!).seconds
            if time >= maximumDuration { Task { _ = try? await stop() }; return }
            try track.append(sampleBuffer, origin: origin!)
            last = CMTimeAdd(sampleBuffer.presentationTimeStamp, sampleBuffer.duration)
        } catch { failure = error; Task { _ = try? await stop() } }
    }

    func stop() async throws -> [String: Any] {
        let task: Task<[String: Any], Error> = queue.sync {
            if let finishTask { return finishTask }
            let task = Task { try await self.finish() }
            finishTask = task
            return task
        }
        return try await task.value
    }

    private func finish() async throws -> [String: Any] {
        queue.sync { finishing = true; timer?.cancel(); timer = nil }
        await independentInput?.stop(); independentInput = nil
        await withCheckedContinuation { continuation in
            control.async { self.capture.stopRunning(); continuation.resume() }
        }
        let duration = try queue.sync {
            guard let origin, let last else { throw failure ?? CaptureFailure("麦克风没有可用试录数据") }
            return min(maximumDuration, max(0, CMTimeSubtract(last, origin).seconds))
        }
        try await track.finish(duration: duration)
        return try queue.sync {
            self.duration = duration
            if let failure { throw failure }
            return ["duration": duration]
        }
    }
}
