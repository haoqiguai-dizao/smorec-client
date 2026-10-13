import AVFoundation
import VideoToolbox
import CaptureCore

/// AVAssetWriter owns VideoToolbox encoding. Fragmented MP4 keeps committed fragments recoverable.
final class VideoTrack {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var first: CMTime?
    private var last: CMTime?
    private let fps: Int
    private(set) var dropped = 0

    init(url: URL, width: Int, height: Int, fps: Int) throws {
        self.fps = fps
        writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        writer.movieFragmentInterval = CMTime(seconds: 1, preferredTimescale: 60000)
        writer.movieTimeScale = 60000
        let codec = try VideoEncoding.hardwareCodec(width: width, height: height)
        let compression: [String: Any] = [AVVideoAverageBitRateKey: max(4_000_000, width * height * fps / 5),
            AVVideoExpectedSourceFrameRateKey: fps, AVVideoMaxKeyFrameIntervalKey: fps * 2,
            AVVideoAllowFrameReorderingKey: false,
            AVVideoProfileLevelKey: codec == .h264 ? AVVideoProfileLevelH264HighAutoLevel : kVTProfileLevel_HEVC_Main_AutoLevel]
        let settings: [String: Any] = [
            AVVideoCodecKey: codec, AVVideoWidthKey: width, AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: compression,
            AVVideoEncoderSpecificationKey: [kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder as String: true]
        ]
        input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw CaptureFailure("当前 Mac 不支持所选录制规格") }
        writer.add(input)
    }

    func append(_ sample: CMSampleBuffer) throws -> Bool {
        guard writer.status != .failed else { throw writer.error ?? CaptureFailure("屏幕编码失败") }
        let pts = sample.presentationTimeStamp
        if writer.status == .unknown {
            guard writer.startWriting() else { throw writer.error ?? CaptureFailure("屏幕编码器启动失败") }
            writer.startSession(atSourceTime: pts)
        }
        guard input.isReadyForMoreMediaData else { dropped += 1; return false }
        guard input.append(sample) else { throw writer.error ?? CaptureFailure("屏幕视频写入失败") }
        if first == nil { first = pts }
        last = pts
        return true
    }

    func finish(at time: CMTime) async throws -> Double {
        guard let first, let last else { writer.cancelWriting(); throw CaptureFailure("没有收到有效屏幕画面") }
        let end = CMTimeMaximum(time, CMTimeAdd(last, CMTime(value: 1, timescale: Int32(fps))))
        writer.endSession(atSourceTime: end)
        input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? CaptureFailure("屏幕原片保存失败") }
        // endSession does not guarantee that every encoder extends the final sample.
        // Report actual container duration; the project separately records an observed static tail.
        let actual = try await AVURLAsset(url: writer.outputURL).load(.duration).seconds
        guard actual.isFinite, actual > 0, actual <= CMTimeSubtract(end, first).seconds + 1 else {
            throw CaptureFailure("编码文件时长与采集时钟不符，原片已保留")
        }
        return actual
    }

    func cancel() { writer.cancelWriting() }
}
