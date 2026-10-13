import XCTest
import AVFoundation
@testable import XiaoLuCapture

final class MicrophoneInputTests: XCTestCase {
    func testNativeRateHostClockAndOwnedSamplesSurviveBufferReuse() throws {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: true)!
        let frames: UInt32 = 160
        let host = AudioGetCurrentHostTime()
        var samples = [Float](repeating: 0.25, count: Int(frames))
        let sample = try samples.withUnsafeBytes {
            try MicrophoneInputRing.sample(data: $0.baseAddress!, frames: frames, bytesPerFrame: 4,
                rate: 16000, hostTime: host, description: format.formatDescription)
        }
        samples = [Float](repeating: 0.9, count: Int(frames))
        XCTAssertEqual(CMSampleBufferGetNumSamples(sample), Int(frames))
        XCTAssertEqual(sample.duration.seconds, 0.01, accuracy: 0.000001)
        XCTAssertEqual(sample.presentationTimeStamp.seconds, CMClockMakeHostTimeFromSystemUnits(host).seconds, accuracy: 0.000001)
        let block = try XCTUnwrap(CMSampleBufferGetDataBuffer(sample))
        var copied = [Float](repeating: 0, count: Int(frames))
        XCTAssertEqual(CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: Int(frames) * 4, destination: &copied), noErr)
        XCTAssertEqual(copied, [Float](repeating: 0.25, count: Int(frames)))
    }

    func testExplicitDisconnectedMicrophoneCannotFallBackToDefault() {
        XCTAssertThrowsError(try CoreAudioInputDevice.resolve("xiaolu-disconnected-test-device"))
    }

    /// Opt-in physical check; ordinary test runs never open the user's devices.
    func testPhysicalIndependentInputWhenExplicitlyRequested() async throws {
        guard ProcessInfo.processInfo.environment["XIAOLU_TEST_HAL_INPUT"] == "1" else { throw XCTSkip("需要显式启用实机麦克风检查") }
        let received = expectation(description: "independent input returns host-timed samples")
        received.assertForOverFulfill = false
        let queue = DispatchQueue(label: "test.microphone-input")
        let capture = HALMicrophoneCapture(deviceID: nil, delivery: queue, receive: { sample in
            XCTAssertTrue(sample.isValid)
            XCTAssertLessThan(abs(sample.presentationTimeStamp.seconds - CMClockGetTime(CMClockGetHostTimeClock()).seconds), 1)
            received.fulfill()
        }, fail: { XCTFail($0.localizedDescription) })
        try await capture.start()
        await fulfillment(of: [received], timeout: 3)
        await capture.stop()
    }
}
