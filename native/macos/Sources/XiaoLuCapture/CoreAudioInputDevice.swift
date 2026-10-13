import AVFoundation
import CoreAudio
import CaptureCore

/// Resolve exactly the selected microphone. Never change the Mac's default devices or rates.
enum CoreAudioInputDevice {
    static func selected(_ id: String?) throws -> AVCaptureDevice {
        let device = id == nil || id == "" ? AVCaptureDevice.default(for: .audio) : AVCaptureDevice(uniqueID: id!)
        guard let device, device.hasMediaType(.audio) else { throw CaptureFailure("所选麦克风已断开") }
        return device
    }

    static func needsIndependentInput(_ id: String?) throws -> Bool {
        let transport = UInt32(bitPattern: try selected(id).transportType)
        return transport == kAudioDeviceTransportTypeBluetooth || transport == kAudioDeviceTransportTypeBluetoothLE
    }

    static func resolve(_ id: String?) throws -> AudioDeviceID {
        let uid = try selected(id).uniqueID
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var size: UInt32 = 0
        try check(AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size))
        var devices = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
        try check(AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices))
        for device in devices {
            address.mSelector = kAudioDevicePropertyDeviceUID
            var value: Unmanaged<CFString>?
            size = UInt32(MemoryLayout.size(ofValue: value))
            let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &value)
            if status == noErr, let value, value.takeRetainedValue() as String == uid { return device }
        }
        throw CaptureFailure("无法连接所选麦克风，请刷新设备列表后重试")
    }

    static func check(_ status: OSStatus) throws {
        guard status == noErr else { throw CaptureFailure("麦克风输入通道无法启动（\(status)），请检查设备后重试") }
    }
}
