import AVFoundation
import CaptureCore

/// Timestamp-aligned, recoverable float32 WAV. Each owner uses one serial queue.
final class AudioTrack {
    private let file: FileHandle
    private let url: URL
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false)!
    private(set) var frames: Int64 = 0
    private(set) var received = false
    private var checkpoint: Int64 = 0
    private var closed = false
    var muted = false
    private let onLevel: ((Double) -> Void)?
    private var levelFrames: Int64 = 0

    init(url: URL, onLevel: ((Double) -> Void)? = nil) throws {
        self.url = url
        self.onLevel = onLevel
        guard !FileManager.default.fileExists(atPath: url.path),
              FileManager.default.createFile(atPath: url.path, contents: Data(repeating: 0, count: 44)) else {
            throw CaptureFailure("无法创建声音原片，或输出文件已存在")
        }
        file = try FileHandle(forUpdating: url)
        try file.seek(toOffset: 44)
        try updateHeader()
    }

    func append(_ sample: CMSampleBuffer, origin: CMTime) throws {
        guard !closed, let description = sample.formatDescription else { throw CaptureFailure("音频格式无效") }
        let format = AVAudioFormat(cmAudioFormatDescription: description)
        let time = CMTimeSubtract(sample.presentationTimeStamp, origin).seconds
        guard time.isFinite, time > -10, time < 86400 * 7 else { throw CaptureFailure("音频采集时钟无效") }
        let buffers = AudioBufferList.allocate(maximumBuffers: Int(format.channelCount))
        defer { free(buffers.unsafeMutablePointer) }
        var block: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,
            bufferListSizeNeededOut: nil, bufferListOut: buffers.unsafeMutablePointer,
            bufferListSize: AudioBufferList.sizeInBytes(maximumBuffers: Int(format.channelCount)),
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment), blockBufferOut: &block)
        guard status == noErr, let input = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: buffers.unsafePointer) else {
            throw CaptureFailure("无法读取麦克风或系统音频数据")
        }
        if sourceFormat != format {
            sourceFormat = format
            converter = AVAudioConverter(from: format, to: target)
        }
        guard let converter else { throw CaptureFailure("无法转换音频设备格式") }
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * 48000 / format.sampleRate) + 256)
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { throw CaptureFailure("声音缓存分配失败") }
        var supplied = false, conversionError: NSError?
        let conversion = converter.convert(to: output, error: &conversionError) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return input
        }
        guard conversion != .error, conversionError == nil else { throw conversionError ?? CaptureFailure("音频转换失败") as NSError }
        received = true
        let start = Int64((time * 48000).rounded())
        // A discontinuity is an explicit failure, never concealed by unlimited padding.
        guard start - frames <= 48000 * 3 else { throw CaptureFailure("声音设备中断超过三秒，已有原片已保留") }
        if start > frames { try silence(start - frames) }
        let skip = Int(max(0, frames - start)), count = Int(output.frameLength) - skip
        guard count > 0, let channels = output.floatChannelData else { return }
        if muted { try silence(Int64(count)); return }
        var samples = [Float](repeating: 0, count: count * 2)
        for index in 0..<count {
            samples[index * 2] = channels[0][index + skip]
            samples[index * 2 + 1] = channels[1][index + skip]
        }
        if let onLevel, frames - levelFrames >= 2400 || levelFrames == 0 {
            let rms = sqrt(samples.reduce(0.0) { $0 + Double($1 * $1) } / Double(samples.count))
            let level = rms < 0.0012 ? 0 : pow(max(0, min(1, (20 * log10(rms) + 50) / 50)), 0.7)
            onLevel(level)
            levelFrames = frames
        }
        try write(samples.withUnsafeBytes { Data($0) }, frameCount: Int64(count))
    }

    private func write(_ data: Data, frameCount: Int64) throws {
        guard (frames + frameCount) * 8 < Int64(UInt32.max) - 36 else { throw CaptureFailure("声音原片接近 WAV 大小上限，请结束本次录制") }
        try file.write(contentsOf: data)
        frames += frameCount
        if frames - checkpoint >= 48000 { try updateHeader(); checkpoint = frames }
    }

    private func silence(_ count: Int64) throws {
        var remaining = count
        while remaining > 0 {
            let length = min(remaining, 48000)
            try write(Data(repeating: 0, count: Int(length) * 8), frameCount: length)
            remaining -= length
        }
    }
    /// Explicit user source changes create silence on the existing recording clock.
    /// Sparse padding avoids allocating a long silent prefix when a source is enabled late.
    func align(to time: Double) throws {
        guard time.isFinite, time >= 0, time < 86400 * 7, !closed else { throw CaptureFailure("声音采集时钟无效") }
        let wanted = Int64((time * 48000).rounded())
        guard wanted * 8 < Int64(UInt32.max) - 36 else { throw CaptureFailure("声音原片接近WAV大小上限") }
        if wanted <= frames { return }
        frames = wanted
        try file.truncate(atOffset: UInt64(44 + frames * 8))
        try updateHeader()
    }

    private func updateHeader() throws {
        var header = Data()
        func bytes<T: FixedWidthInteger>(_ value: T) { var le = value.littleEndian; withUnsafeBytes(of: &le) { header.append(contentsOf: $0) } }
        header.append(Data("RIFF".utf8)); bytes(UInt32(frames * 8 + 36)); header.append(Data("WAVEfmt ".utf8))
        bytes(UInt32(16)); bytes(UInt16(3)); bytes(UInt16(2)); bytes(UInt32(48000)); bytes(UInt32(384000))
        bytes(UInt16(8)); bytes(UInt16(32)); header.append(Data("data".utf8)); bytes(UInt32(frames * 8))
        try file.seek(toOffset: 0); try file.write(contentsOf: header); try file.seekToEnd()
        try file.synchronize()
    }

    func finish(duration: Double) throws {
        guard !closed else { return }
        let wanted = max(0, Int64((duration * 48000).rounded()))
        if wanted > frames { try silence(wanted - frames) }
        else if wanted < frames { frames = wanted; try file.truncate(atOffset: UInt64(44 + frames * 8)) }
        try updateHeader(); try file.close(); closed = true
    }
    deinit { try? file.close() }
}
