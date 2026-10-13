import AudioToolbox
import CoreMedia
import Synchronization
import CaptureCore

/// Single producer / single consumer. The audio callback only renders into preallocated slots.
/// Sample allocation and conversion happen on the consumer queue, never on the audio thread.
final class MicrophoneInputRing {
    private struct Slot {
        var buffers: AudioBufferList
        var frames: UInt32 = 0
        var hostTime: UInt64 = 0
    }
    private let capacity = 128
    private let maximumFrames: UInt32
    private let bytesPerFrame: UInt32
    private let slots: UnsafeMutablePointer<Slot>
    private let read = Atomic<UInt64>(0)
    private let written = Atomic<UInt64>(0)
    private let error = Atomic<Int32>(0)
    let description: CMAudioFormatDescription
    let rate: Double

    init(format: AudioStreamBasicDescription, maximumFrames: UInt32) throws {
        var format = format
        var description: CMAudioFormatDescription?
        try CoreAudioInputDevice.check(CMAudioFormatDescriptionCreate(allocator: nil, asbd: &format,
            layoutSize: 0, layout: nil, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &description))
        guard let description, maximumFrames > 0, maximumFrames <= 16384,
              format.mBytesPerFrame > 0 else { throw CaptureFailure("麦克风缓存格式无效") }
        self.description = description; rate = format.mSampleRate
        self.maximumFrames = maximumFrames; bytesPerFrame = format.mBytesPerFrame
        slots = .allocate(capacity: capacity)
        for index in 0..<capacity {
            let bytes = Int(maximumFrames * bytesPerFrame)
            let data = UnsafeMutableRawPointer.allocate(byteCount: bytes, alignment: 16)
            slots.advanced(by: index).initialize(to: Slot(buffers: AudioBufferList(mNumberBuffers: 1,
                mBuffers: AudioBuffer(mNumberChannels: format.mChannelsPerFrame, mDataByteSize: UInt32(bytes), mData: data))))
        }
    }

    func render(_ unit: AudioUnit, flags: UnsafeMutablePointer<AudioUnitRenderActionFlags>,
                timestamp: UnsafePointer<AudioTimeStamp>, frames: UInt32) {
        guard error.load(ordering: .relaxed) == 0 else { return }
        let next = written.load(ordering: .relaxed)
        guard frames <= maximumFrames, next - read.load(ordering: .acquiring) < capacity,
              timestamp.pointee.mFlags.contains(.hostTimeValid) else {
            error.store(kAudioUnitErr_TooManyFramesToProcess, ordering: .releasing); return
        }
        let slot = slots.advanced(by: Int(next % UInt64(capacity)))
        slot.pointee.buffers.mBuffers.mDataByteSize = frames * bytesPerFrame
        let status = AudioUnitRender(unit, flags, timestamp, 1, frames, &slot.pointee.buffers)
        guard status == noErr else { error.store(status, ordering: .releasing); return }
        slot.pointee.frames = frames; slot.pointee.hostTime = timestamp.pointee.mHostTime
        written.store(next + 1, ordering: .releasing)
    }

    func drain(_ receive: (CMSampleBuffer) -> Void) throws {
        while read.load(ordering: .relaxed) < written.load(ordering: .acquiring) {
            let index = read.load(ordering: .relaxed)
            let slot = slots.advanced(by: Int(index % UInt64(capacity))).pointee
            let sample = try Self.sample(data: slot.buffers.mBuffers.mData!, frames: slot.frames,
                bytesPerFrame: bytesPerFrame, rate: rate, hostTime: slot.hostTime, description: description)
            receive(sample)
            read.store(index + 1, ordering: .releasing)
        }
        let status = error.load(ordering: .acquiring)
        guard status == noErr else { throw CaptureFailure("麦克风输入中断或缓存繁忙（\(status)），已有素材已保留") }
    }

    static func sample(data: UnsafeRawPointer, frames: UInt32, bytesPerFrame: UInt32, rate: Double,
                       hostTime: UInt64, description: CMAudioFormatDescription) throws -> CMSampleBuffer {
        let length = Int(frames * bytesPerFrame)
        var block: CMBlockBuffer?
        try CoreAudioInputDevice.check(CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil,
            blockLength: length, blockAllocator: nil, customBlockSource: nil, offsetToData: 0,
            dataLength: length, flags: 0, blockBufferOut: &block))
        guard let block else { throw CaptureFailure("无法分配麦克风样本") }
        try CoreAudioInputDevice.check(CMBlockBufferReplaceDataBytes(with: data, blockBuffer: block, offsetIntoDestination: 0, dataLength: length))
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: Int32(rate)),
            presentationTimeStamp: CMClockMakeHostTimeFromSystemUnits(hostTime), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        try CoreAudioInputDevice.check(CMSampleBufferCreateReady(allocator: nil, dataBuffer: block,
            formatDescription: description, sampleCount: Int(frames), sampleTimingEntryCount: 1,
            sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil, sampleBufferOut: &sample))
        guard let sample else { throw CaptureFailure("无法读取麦克风样本") }
        return sample
    }

    deinit {
        for index in 0..<capacity { slots[index].buffers.mBuffers.mData?.deallocate() }
        slots.deinitialize(count: capacity); slots.deallocate()
    }
}
