import AudioToolbox
import CoreMedia
import CaptureCore

/// Input-only AUHAL, bound to the user's selected device. Output bus stays disabled.
/// Follows Apple TN2091; device format and system input/output defaults are read-only.
final class HALMicrophoneCapture: @unchecked Sendable {
    private let deviceID: String?
    private let control = DispatchQueue(label: "smorec.microphone-hal-control")
    private let delivery: DispatchQueue
    private let receive: (CMSampleBuffer) -> Void
    private let fail: (Error) -> Void
    private var unit: AudioUnit?
    private var ring: MicrophoneInputRing?
    private var signal: DispatchSourceUserDataAdd?
    private var failed = false

    init(deviceID: String?, delivery: DispatchQueue, receive: @escaping (CMSampleBuffer) -> Void,
         fail: @escaping (Error) -> Void) {
        self.deviceID = deviceID; self.delivery = delivery; self.receive = receive; self.fail = fail
    }

    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            control.async {
                do { try self.configure(); continuation.resume() }
                catch {
                    self.dispose()
                    self.delivery.async { self.signal?.cancel(); self.signal = nil; self.ring = nil }
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func configure() throws {
        var description = AudioComponentDescription(componentType: kAudioUnitType_Output,
            componentSubType: kAudioUnitSubType_HALOutput, componentManufacturer: kAudioUnitManufacturer_Apple,
            componentFlags: 0, componentFlagsMask: 0)
        guard let component = AudioComponentFindNext(nil, &description) else { throw CaptureFailure("麦克风输入组件不可用") }
        var instance: AudioUnit?
        try CoreAudioInputDevice.check(AudioComponentInstanceNew(component, &instance))
        guard let instance else { throw CaptureFailure("麦克风输入组件无法创建") }
        unit = instance
        var enable: UInt32 = 1, disable: UInt32 = 0
        try set(kAudioOutputUnitProperty_EnableIO, scope: kAudioUnitScope_Input, bus: 1, value: &enable)
        try set(kAudioOutputUnitProperty_EnableIO, scope: kAudioUnitScope_Output, bus: 0, value: &disable)
        var device = try CoreAudioInputDevice.resolve(deviceID)
        try set(kAudioOutputUnitProperty_CurrentDevice, value: &device)
        var format = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout.size(ofValue: format))
        try CoreAudioInputDevice.check(AudioUnitGetProperty(instance, kAudioUnitProperty_StreamFormat,
            kAudioUnitScope_Input, 1, &format, &size))
        guard format.mSampleRate.isFinite, format.mSampleRate >= 8000, format.mSampleRate <= 384000,
              format.mChannelsPerFrame > 0, format.mChannelsPerFrame <= 32 else { throw CaptureFailure("所选麦克风格式不受支持") }
        // Keep the hardware's rate/channels. Resample later in the existing audio writer/mixer.
        format.mFormatID = kAudioFormatLinearPCM
        format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked
        format.mBitsPerChannel = 32; format.mFramesPerPacket = 1
        format.mBytesPerFrame = 4 * format.mChannelsPerFrame; format.mBytesPerPacket = format.mBytesPerFrame
        try set(kAudioUnitProperty_StreamFormat, scope: kAudioUnitScope_Output, bus: 1, value: &format)
        var maximumFrames: UInt32 = 4096
        try set(kAudioUnitProperty_MaximumFramesPerSlice, value: &maximumFrames)
        ring = try MicrophoneInputRing(format: format, maximumFrames: maximumFrames)
        let signal = DispatchSource.makeUserDataAddSource(queue: delivery)
        self.signal = signal
        signal.setEventHandler { [weak self] in self?.drain() }
        signal.resume()
        var callback = AURenderCallbackStruct(inputProc: { context, flags, timestamp, _, frames, _ in
            let capture = Unmanaged<HALMicrophoneCapture>.fromOpaque(context).takeUnretainedValue()
            if let unit = capture.unit { capture.ring?.render(unit, flags: flags, timestamp: timestamp, frames: frames) }
            capture.signal?.add(data: 1)
            return noErr
        }, inputProcRefCon: Unmanaged.passUnretained(self).toOpaque())
        try set(kAudioOutputUnitProperty_SetInputCallback, value: &callback)
        try CoreAudioInputDevice.check(AudioUnitInitialize(instance))
        try CoreAudioInputDevice.check(AudioOutputUnitStart(instance))
        Wire.diagnostic("麦克风使用独立输入通道：\(Int(format.mSampleRate)) Hz / \(format.mChannelsPerFrame) 声道；系统输出保持不变")
    }

    private func set<T>(_ property: AudioUnitPropertyID, scope: AudioUnitScope = kAudioUnitScope_Global,
                        bus: AudioUnitElement = 0, value: inout T) throws {
        try withUnsafeBytes(of: &value) { bytes in
            try CoreAudioInputDevice.check(AudioUnitSetProperty(unit!, property, scope, bus, bytes.baseAddress!, UInt32(bytes.count)))
        }
    }

    private func drain() {
        guard !failed else { return }
        do { try ring?.drain(receive) }
        catch { failed = true; fail(error) }
    }

    func stop() async {
        await withCheckedContinuation { continuation in
            control.async { self.dispose(); continuation.resume() }
        }
        await withCheckedContinuation { continuation in
            delivery.async {
                self.drain(); self.signal?.cancel(); self.signal = nil; self.ring = nil
                continuation.resume()
            }
        }
    }

    private func dispose() {
        guard let unit else { return }
        AudioOutputUnitStop(unit); AudioUnitUninitialize(unit); AudioComponentInstanceDispose(unit)
        self.unit = nil
    }
}
