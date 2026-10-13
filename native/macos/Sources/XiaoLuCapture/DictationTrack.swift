import AVFoundation
import CaptureCore

/// A bounded clip of the already-open microphone. All calls stay on the recording queue.
final class DictationTrack {
    let id: String
    private let audio: AudioTrack
    private var origin: CMTime?
    private var duration = 0.0
    private var failure: Error?

    init(id: String, directory: URL) throws {
        self.id = id
        audio = try AudioTrack(url: directory.appendingPathComponent("microphone.wav")) { level in
            Wire.send(["event": "dictation-level", "dictationId": id, "level": level])
        }
    }
    func append(_ sample: CMSampleBuffer) {
        guard failure == nil, duration < 30 else { return }
        do {
            if origin == nil { origin = sample.presentationTimeStamp }
            guard let origin else { return }
            let time = CMTimeSubtract(sample.presentationTimeStamp, origin).seconds
            guard time < 30 else { duration = 30; return }
            try audio.append(sample, origin: origin)
            let rate = sample.formatDescription.flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee.mSampleRate } ?? 48000
            let sampleDuration = Double(CMSampleBufferGetNumSamples(sample)) / max(1, rate)
            duration = min(30, max(duration, time + sampleDuration))
        } catch { failure = error }
    }
    func finish() throws -> [String: Any] {
        if let failure { throw failure }
        guard audio.received, duration > 0 else { throw CaptureFailure("麦克风没有可用语音，请检查输入设备后重试") }
        try audio.finish(duration: duration)
        return ["duration": duration]
    }
}
