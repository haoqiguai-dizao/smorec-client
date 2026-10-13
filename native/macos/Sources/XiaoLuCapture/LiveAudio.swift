import AVFoundation
import CaptureCore

/// A bounded native-clock mixer; it never records recovery files or grows a sample queue.
final class LiveAudio: @unchecked Sendable {
    private let lock = NSLock()
    private let capacity = 48000 * 3
    private var samples = [[Float](repeating: 0, count: 48000 * 3 * 2), [Float](repeating: 0, count: 48000 * 3 * 2)]
    private var stamps = [[Int64](repeating: -1, count: 48000 * 3), [Int64](repeating: -1, count: 48000 * 3)]
    private var formats: [AVAudioFormat?] = [nil, nil]
    private var converters: [AVAudioConverter?] = [nil, nil]
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false)!
    private var read: Int64 = 0
    private var enabled: [Bool]
    private(set) var microphonePackets = 0

    init(system: Bool, microphone: Bool) { enabled = [system, microphone] }
    func setEnabled(system: Bool, microphone: Bool) {
        lock.lock(); defer { lock.unlock() }
        let next = [system, microphone]
        for track in 0..<2 where next[track] != enabled[track] {
            stamps[track] = [Int64](repeating: -1, count: capacity)
        }
        enabled = next
    }
    func append(_ sample: CMSampleBuffer, origin: CMTime, track: Int) throws {
        guard sample.isValid, let description = sample.formatDescription else { throw CaptureFailure("直播声音格式无效") }
        let format = AVAudioFormat(cmAudioFormatDescription: description)
        let time = CMTimeSubtract(sample.presentationTimeStamp, origin).seconds
        guard time.isFinite, time > -10 else { throw CaptureFailure("直播声音时钟无效") }
        let buffers = AudioBufferList.allocate(maximumBuffers: Int(format.channelCount))
        defer { free(buffers.unsafeMutablePointer) }
        var block: CMBlockBuffer?
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,
            bufferListSizeNeededOut: nil, bufferListOut: buffers.unsafeMutablePointer,
            bufferListSize: AudioBufferList.sizeInBytes(maximumBuffers: Int(format.channelCount)),
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment), blockBufferOut: &block)
        guard status == noErr, let input = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: buffers.unsafePointer) else {
            throw CaptureFailure("无法读取直播声音数据")
        }
        if formats[track] != format { formats[track] = format; converters[track] = AVAudioConverter(from: format, to: target) }
        guard let converter = converters[track] else { throw CaptureFailure("无法转换直播声音格式") }
        let size = AVAudioFrameCount(ceil(Double(input.frameLength) * 48000 / format.sampleRate) + 256)
        guard size <= 24000, let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: size) else { throw CaptureFailure("直播声音数据超出缓冲限制") }
        var supplied = false, error: NSError?
        let result = converter.convert(to: output, error: &error) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return input
        }
        guard result != .error, error == nil, let channels = output.floatChannelData else {
            throw error ?? CaptureFailure("直播声音转换失败") as NSError
        }
        if track == 1 { microphonePackets += 1 }
        let start = Int64((time * 48000).rounded())
        lock.lock(); defer { lock.unlock() }
        guard enabled[track] else { return }
        for index in 0..<Int(output.frameLength) {
            let frame = start + Int64(index)
            if frame < 0 || frame < read { continue }
            let slot = Int(frame % Int64(capacity))
            stamps[track][slot] = frame
            for channel in 0..<2 {
                let value = channels[channel][index]
                samples[track][slot * 2 + channel] = value.isFinite ? value : 0
            }
        }
    }
    func pull(now: Double) -> (data: Data, time: Double) {
        lock.lock(); defer { lock.unlock() }
        let end = max(read, Int64((max(0, now - 0.12) * 48000).rounded(.down)))
        read = max(read, end - 24000)
        let start = read, count = Int(end - start)
        var output = [Float](repeating: 0, count: count * 2)
        let gain: Float = enabled[0] && enabled[1] ? 0.5 : 1
        for index in 0..<count {
            let frame = start + Int64(index), slot = Int(frame % Int64(capacity))
            for channel in 0..<2 {
                var value: Float = 0
                for track in 0..<2 where enabled[track] && stamps[track][slot] == frame { value += samples[track][slot * 2 + channel] * gain }
                output[index * 2 + channel] = max(-1, min(1, value))
            }
        }
        read = end
        return (output.withUnsafeBytes { Data($0) }, Double(start) / 48000)
    }
}
