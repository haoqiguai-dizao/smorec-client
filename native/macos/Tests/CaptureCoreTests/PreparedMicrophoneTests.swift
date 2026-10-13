import XCTest
import AVFoundation
import CaptureCore
@testable import XiaoLuCapture

private final class SyntheticInput: MicrophoneInputCapture {
    let receive: (CMSampleBuffer) -> Void
    let fail: (Error) -> Void
    var stopped = false
    init(_ receive: @escaping (CMSampleBuffer) -> Void, _ fail: @escaping (Error) -> Void) { self.receive = receive; self.fail = fail }
    func start() async throws {}
    func stop() async { stopped = true }
}
final class PreparedMicrophoneTests: XCTestCase {
    private func sample() throws -> CMSampleBuffer {
        let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000), presentationTimeStamp: .zero, decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        XCTAssertEqual(CMSampleBufferCreate(allocator: kCFAllocatorDefault, dataBuffer: nil, dataReady: true,
            makeDataReadyCallback: nil, refcon: nil, formatDescription: format.formatDescription, sampleCount: 480,
            sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sample), noErr)
        return sample!
    }
    func testPreparedSamplesDoNotReachWriterUntilCommitAndRetiredCallbacksCannotFailReplacement() async throws {
        let queue = DispatchQueue(label: "test.microphone"), sample = try sample()
        var input: SyntheticInput!, delivered = 0, failures = 0
        let selection = PreparedMicrophoneInput(deviceID: nil, queue: queue, receive: { _ in delivered += 1 }, fail: { _ in failures += 1 }, factory: {
            input = SyntheticInput($0, $1); return input
        })
        queue.sync { input.receive(sample); input.receive(sample) }
        try await selection.prepare()
        XCTAssertEqual(delivered, 0)
        try queue.sync { try selection.commit(); input.receive(sample) }
        XCTAssertEqual(delivered, 1)
        await selection.stop()
        queue.sync { input.receive(sample); input.fail(CaptureFailure("late old-device failure")) }
        XCTAssertEqual(delivered, 1); XCTAssertEqual(failures, 0); XCTAssertTrue(input.stopped)
    }
    func testFailureBetweenReadinessAndCommitRejectsTheCandidateWithoutForwardingItsAudio() async throws {
        let queue = DispatchQueue(label: "test.microphone.failure"), sample = try sample()
        var input: SyntheticInput!, delivered = 0
        let selection = PreparedMicrophoneInput(deviceID: nil, queue: queue, receive: { _ in delivered += 1 }, fail: { _ in XCTFail("uncommitted input") }, factory: {
            input = SyntheticInput($0, $1); return input
        })
        queue.sync { input.receive(sample); input.receive(sample) }
        try await selection.prepare()
        queue.sync { input.fail(CaptureFailure("device disappeared")) }
        XCTAssertThrowsError(try queue.sync { try selection.commit() })
        XCTAssertEqual(delivered, 0); await selection.stop(); XCTAssertTrue(input.stopped)
    }
}
