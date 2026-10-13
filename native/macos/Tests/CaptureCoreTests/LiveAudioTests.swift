import XCTest
import AVFoundation
@testable import XiaoLuCapture

final class LiveAudioTests: XCTestCase {
    private func sample(_ time: Double) throws -> CMSampleBuffer {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 480)!
        buffer.frameLength = 480
        for channel in 0..<2 { for i in 0..<480 { buffer.floatChannelData![channel][i] = 0.25 } }
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000),
            presentationTimeStamp: CMTime(seconds: time, preferredTimescale: 48000), decodeTimeStamp: .invalid)
        var result: CMSampleBuffer?
        XCTAssertEqual(CMSampleBufferCreate(allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil,
            refcon: nil, formatDescription: format.formatDescription, sampleCount: 480,
            sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
            sampleBufferOut: &result), noErr)
        XCTAssertEqual(CMSampleBufferSetDataBufferFromAudioBufferList(result!, blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil, flags: 0, bufferList: buffer.audioBufferList), noErr)
        XCTAssertEqual(CMSampleBufferSetDataReady(result!), noErr)
        return result!
    }
    private func peak(_ data: Data) -> Float {
        data.withUnsafeBytes { bytes in bytes.bindMemory(to: Float.self).map { abs($0) }.max() ?? 0 }
    }
    func testInitiallyDisabledChannelsCanStartWithoutResettingPCMClock() throws {
        let mixer = LiveAudio(system: false, microphone: false)
        try mixer.append(sample(0), origin: .zero, track: 1)
        let silent = mixer.pull(now: 0.13)
        XCTAssertEqual(peak(silent.data), 0)
        XCTAssertEqual(mixer.microphonePackets, 1)
        mixer.setEnabled(system: false, microphone: true)
        try mixer.append(sample(0.01), origin: .zero, track: 1)
        let active = mixer.pull(now: 0.14)
        XCTAssertEqual(active.time, 0.01, accuracy: 0.0001)
        XCTAssertEqual(peak(active.data), 0.25, accuracy: 0.01)
    }
    func testDisableClearsQueuedPCMAndReenableDoesNotReplayOldSound() throws {
        let mixer = LiveAudio(system: true, microphone: true)
        try mixer.append(sample(0.01), origin: .zero, track: 1)
        mixer.setEnabled(system: true, microphone: false)
        mixer.setEnabled(system: true, microphone: true)
        XCTAssertEqual(peak(mixer.pull(now: 0.14).data), 0)
        try mixer.append(sample(0.02), origin: .zero, track: 0)
        try mixer.append(sample(0.02), origin: .zero, track: 1)
        XCTAssertEqual(peak(mixer.pull(now: 0.15).data), 0.25, accuracy: 0.01)
        mixer.setEnabled(system: true, microphone: false)
        try mixer.append(sample(0.03), origin: .zero, track: 0)
        XCTAssertEqual(peak(mixer.pull(now: 0.16).data), 0.25, accuracy: 0.01)
    }
}
