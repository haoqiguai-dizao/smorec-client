import XCTest
import AVFoundation
@testable import XiaoLuCapture

final class MediaTests: XCTestCase {
    func folder() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("smorec-media-test-\(UUID())")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        addTeardownBlock { try FileManager.default.removeItem(at: url) }
        return url
    }

    func audio(time: Double, channels: AVAudioChannelCount = 1) throws -> CMSampleBuffer {
        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: channels, interleaved: false)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 480)!
        buffer.frameLength = 480
        for channel in 0..<Int(channels) { for i in 0..<480 { buffer.floatChannelData![channel][i] = 0.25 } }
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000),
            presentationTimeStamp: CMTime(seconds: time, preferredTimescale: 48000), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        XCTAssertEqual(CMSampleBufferCreate(allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil,
            refcon: nil, formatDescription: format.formatDescription, sampleCount: 480,
            sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
            sampleBufferOut: &sample), noErr)
        XCTAssertEqual(CMSampleBufferSetDataBufferFromAudioBufferList(sample!, blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil, flags: 0, bufferList: buffer.audioBufferList), noErr)
        XCTAssertEqual(CMSampleBufferSetDataReady(sample!), noErr)
        return sample!
    }

    func testMonoAudioTimingSilenceAndUnmutedAmplitude() throws {
        let file = try folder().appendingPathComponent("microphone.wav")
        let track = try AudioTrack(url: file)
        for i in 0..<10 { try track.append(audio(time: Double(i) / 100), origin: .zero) }
        track.muted = true
        for i in 10..<20 { try track.append(audio(time: Double(i) / 100), origin: .zero) }
        try track.finish(duration: 0.3)
        let stored = try AVAudioFile(forReading: file)
        XCTAssertEqual(stored.length, 14400)
        XCTAssertEqual(stored.processingFormat.channelCount, 2)
        let decoded = AVAudioPCMBuffer(pcmFormat: stored.processingFormat, frameCapacity: 14400)!
        try stored.read(into: decoded)
        // Exclude converter priming: both channels preserve the input level after startup.
        XCTAssertEqual(decoded.floatChannelData![0][2400], 0.25, accuracy: 0.01)
        XCTAssertEqual(decoded.floatChannelData![1][2400], 0.25, accuracy: 0.01)
        XCTAssertEqual(decoded.floatChannelData![0][7000], 0)
        XCTAssertEqual(decoded.floatChannelData![1][13000], 0)
    }

    func testAudioDiscontinuityIsRejectedAndExistingFileNotOverwritten() throws {
        let file = try folder().appendingPathComponent("system.wav")
        let track = try AudioTrack(url: file)
        try track.append(audio(time: 0, channels: 2), origin: .zero)
        XCTAssertThrowsError(try track.append(audio(time: 20, channels: 2), origin: .zero))
        try track.finish(duration: 0.01)
        XCTAssertThrowsError(try AudioTrack(url: file))
    }
    func testExplicitInputChangePreservesEarlierAudioAndPadsTheSourceClock() async throws {
        let file = try folder().appendingPathComponent("changed-input.wav")
        let track = try RecordingAudioTrack(url: file)
        for frame in 0..<10 { try track.append(audio(time: Double(frame) / 100), origin: .zero) }
        track.align(to: 11)
        for frame in 0..<10 { try track.append(audio(time: 11 + Double(frame) / 100, channels: 2), origin: .zero) }
        try await track.finish(duration: 11.2)
        let stored = try AVAudioFile(forReading: file)
        XCTAssertEqual(stored.length, 537600)
        let decoded = AVAudioPCMBuffer(pcmFormat: stored.processingFormat, frameCapacity: 537600)!
        try stored.read(into: decoded)
        XCTAssertEqual(decoded.floatChannelData![0][2400], 0.25, accuracy: 0.01)
        XCTAssertEqual(decoded.floatChannelData![0][240000], 0)
        XCTAssertEqual(decoded.floatChannelData![1][530400], 0.25, accuracy: 0.01)
    }

    func testQueuedAudioPreservesEverySampleAndMuteBoundary() async throws {
        let directory = try folder()
        let direct = try AudioTrack(url: directory.appendingPathComponent("direct.wav"))
        let queued = try RecordingAudioTrack(url: directory.appendingPathComponent("queued.wav"))
        for index in 0..<120 {
            direct.muted = index >= 40 && index < 60
            queued.muted = direct.muted
            let sample = try audio(time: Double(index) / 100, channels: 2)
            try direct.append(sample, origin: .zero)
            try queued.append(sample, origin: .zero)
        }
        try direct.finish(duration: 1.3)
        try await queued.finish(duration: 1.3)
        XCTAssertTrue(queued.received)
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("direct.wav")),
                       try Data(contentsOf: directory.appendingPathComponent("queued.wav")))
    }

    func testBlockedAudioDiskQueueDoesNotBlockCaptureAndHasABoundedBacklog() async throws {
        let directory = try folder()
        let queue = DispatchQueue(label: "test.paused-audio-writer")
        let queued = try RecordingAudioTrack(url: directory.appendingPathComponent("queued.wav"), queue: queue)
        queue.suspend()
        let start = ContinuousClock.now
        for index in 0..<200 { try queued.append(audio(time: Double(index) / 100), origin: .zero) }
        let elapsed = start.duration(to: .now)
        XCTAssertLessThan(elapsed, .milliseconds(200))
        XCTAssertFalse(queued.received)
        XCTAssertThrowsError(try queued.append(audio(time: 2.01), origin: .zero))
        queue.resume()
        try await queued.finish(duration: 2)
        XCTAssertTrue(queued.received)
        XCTAssertEqual(try AVAudioFile(forReading: directory.appendingPathComponent("queued.wav")).length, 96000)
        XCTAssertThrowsError(try queued.append(audio(time: 2.1), origin: .zero))
    }

    func testQueuedWriterFailureIsReportedAndDrainedOnStop() async throws {
        let directory = try folder()
        let queued = try RecordingAudioTrack(url: directory.appendingPathComponent("queued.wav"))
        let failure = expectation(description: "writer reports discontinuity without blocking capture")
        queued.onFailure = { _ in failure.fulfill() }
        try queued.append(audio(time: 0), origin: .zero)
        try queued.append(audio(time: 20), origin: .zero)
        await fulfillment(of: [failure], timeout: 2)
        do { try await queued.finish(duration: 0.01); XCTFail("must preserve explicit failure") }
        catch { XCTAssertTrue(error.localizedDescription.contains("中断超过三秒")) }
        XCTAssertEqual(try AVAudioFile(forReading: directory.appendingPathComponent("queued.wav")).length, 480)
    }

    func testDictationRebasesExistingMicrophoneClockAndIgnoresMainTrackMute() throws {
        let directory = try folder()
        let main = try AudioTrack(url: directory.appendingPathComponent("main.wav"))
        main.muted = true
        let clip = try DictationTrack(id: UUID().uuidString, directory: directory)
        for frame in 0..<100 {
            let sample = try audio(time: 172000 + Double(frame) / 100)
            clip.append(sample)
            try main.append(sample, origin: CMTime(seconds: 172000, preferredTimescale: 48000))
        }
        let result = try clip.finish()
        try main.finish(duration: 1)
        XCTAssertEqual(result["duration"] as! Double, 1, accuracy: 0.0001)
        let file = try AVAudioFile(forReading: directory.appendingPathComponent("microphone.wav"))
        XCTAssertEqual(file.length, 48000)
        let data = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 48000)!
        try file.read(into: data)
        XCTAssertEqual(data.floatChannelData![0][24000], 0.25, accuracy: 0.01)
    }

    func testDictationIsBoundedAndNoDataIsAnExplicitError() throws {
        let empty = try DictationTrack(id: UUID().uuidString, directory: folder())
        XCTAssertThrowsError(try empty.finish())
        let directory = try folder()
        let clip = try DictationTrack(id: UUID().uuidString, directory: directory)
        for frame in 0..<3100 { clip.append(try audio(time: Double(frame) / 100)) }
        XCTAssertEqual(try clip.finish()["duration"] as! Double, 30, accuracy: 0.0001)
        let file = try AVAudioFile(forReading: directory.appendingPathComponent("microphone.wav"))
        XCTAssertEqual(file.length, 30 * 48000)
    }

    func testVideoIsDecodableAndKeepsTimingThroughStaticTail() async throws {
        let file = try folder().appendingPathComponent("screen.mp4")
        let track = try VideoTrack(url: file, width: 320, height: 180, fps: 30)
        var pixel: CVPixelBuffer?
        XCTAssertEqual(CVPixelBufferCreate(nil, 320, 180, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixel), kCVReturnSuccess)
        CVPixelBufferLockBaseAddress(pixel!, [])
        memset(CVPixelBufferGetBaseAddress(pixel!), 96, CVPixelBufferGetDataSize(pixel!))
        CVPixelBufferUnlockBaseAddress(pixel!, [])
        var format: CMVideoFormatDescription?
        XCTAssertEqual(CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: pixel!, formatDescriptionOut: &format), noErr)
        for frame in 0..<15 {
            var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 30),
                presentationTimeStamp: CMTime(value: Int64(frame), timescale: 30), decodeTimeStamp: .invalid)
            var sample: CMSampleBuffer?
            XCTAssertEqual(CMSampleBufferCreateReadyWithImageBuffer(allocator: nil, imageBuffer: pixel!,
                formatDescription: format!, sampleTiming: &timing, sampleBufferOut: &sample), noErr)
            _ = try track.append(sample!)
            try await Task.sleep(for: .milliseconds(34))
        }
        let reported = try await track.finish(at: CMTime(seconds: 1, preferredTimescale: 30))
        let asset = AVURLAsset(url: file)
        let duration = try await asset.load(.duration).seconds
        XCTAssertEqual(reported, duration, accuracy: 0.0001)
        XCTAssertGreaterThanOrEqual(duration, 0.49)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        XCTAssertEqual(tracks.count, 1)
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: tracks[0], outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        reader.add(output); XCTAssertTrue(reader.startReading())
        XCTAssertNotNil(output.copyNextSampleBuffer()?.imageBuffer)
        reader.cancelReading()
    }
}
