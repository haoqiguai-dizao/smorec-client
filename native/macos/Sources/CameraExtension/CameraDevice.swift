import Foundation
import CoreMediaIO
import CoreImage
import Security
import IOKit.audio
import CameraCore

final class CameraDevice: NSObject, CMIOExtensionDeviceSource {
    private(set) var device: CMIOExtensionDevice!
    private var output: CameraStream!
    private var input: CameraStream!
    private let queue: DispatchQueue
    private let pools: [CameraFramePool]
    private let context = CIContext(options: [.cacheIntermediates: false])
    private var timer: DispatchSourceTimer?
    private var latest: CVPixelBuffer?
    private var receivedAt: Double = 0
    private var consumption: UUID?
    private var generation: UInt64 = 0
    init(queue: DispatchQueue) throws {
        self.queue = queue
        pools = try CameraFormat.all.map { try CameraFramePool(format: $0) }
        super.init()
        device = CMIOExtensionDevice(localizedName: CameraIdentity.name, deviceID: CameraIdentity.deviceID,
            legacyDeviceID: CameraIdentity.legacyID, source: self)
        output = try CameraStream(camera: self, sink: false)
        input = try CameraStream(camera: self, sink: true)
        try device.addStream(output.stream); try device.addStream(input.stream)
    }
    var availableProperties: Set<CMIOExtensionProperty> { [.deviceTransportType, .deviceModel] }
    func deviceProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionDeviceProperties {
        let result = CMIOExtensionDeviceProperties(dictionary: [:])
        if properties.contains(.deviceTransportType) { result.transportType = kIOAudioDeviceTransportTypeVirtual }
        if properties.contains(.deviceModel) { result.model = "小录 Virtual Camera v1" }
        return result
    }
    func setDeviceProperties(_ properties: CMIOExtensionDeviceProperties) throws {}
    func clear() { latest = nil; receivedAt = 0; consumption = nil; generation &+= 1 }
    func disconnect(_ client: CMIOExtensionClient) {
        if input.client?.clientID == client.clientID {
            input.client = nil; input.starts = 0; clear(); updateTimer()
        }
    }
    func authorizedProducer(_ client: CMIOExtensionClient) -> Bool {
        // 输入只接受同一 Apple 团队签名的本产品桥接进程，不依靠进程名或可伪造路径。
        guard client.signingID == CameraIdentity.bridgeID else { return false }
        var own: SecCode?, guest: SecCode?, ownStatic: SecStaticCode?, info: CFDictionary?, requirement: SecRequirement?
        guard SecCodeCopySelf([], &own) == errSecSuccess, let own,
              SecCodeCopyStaticCode(own, [], &ownStatic) == errSecSuccess, let ownStatic,
              SecCodeCopySigningInformation(ownStatic, [], &info) == errSecSuccess,
              let team = (info as? [String: Any])?[kSecCodeInfoTeamIdentifier as String] as? String,
              team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { return false }
        let rule = "anchor apple generic and certificate leaf[subject.OU] = \"\(team)\" and identifier \"\(CameraIdentity.bridgeID)\""
        guard SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess,
              SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid: client.pid] as CFDictionary, [], &guest) == errSecSuccess,
              let guest else { return false }
        return SecCodeCheckValidity(guest, [], requirement) == errSecSuccess
    }
    func updateTimer() {
        guard input.starts > 0 || output.starts > 0 else { timer?.cancel(); timer = nil; clear(); return }
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .nanoseconds(1_000_000_000 / Int(CameraFormat.fps)), leeway: .milliseconds(1))
        timer.setEventHandler { [weak self] in self?.tick() }
        self.timer = timer; timer.resume()
    }
    private func tick() {
        consume()
        guard output.starts > 0 else { return }
        let now = CMClockGetTime(CMClockGetHostTimeClock())
        do {
            let format = CameraFormat.all[output.activeIndex]
            let pixels = try pools[output.activeIndex].next()
            let bounds = CGRect(x: 0, y: 0, width: format.width, height: format.height)
            var image = CIImage(color: .black).cropped(to: bounds)
            if let latest, now.seconds - receivedAt < 0.5 {
                let source = CIImage(cvPixelBuffer: latest)
                let scale = min(bounds.width / source.extent.width, bounds.height / source.extent.height)
                let scaled = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                let centered = scaled.transformed(by: CGAffineTransform(translationX: (bounds.width - scaled.extent.width) / 2,
                    y: (bounds.height - scaled.extent.height) / 2))
                image = centered.composited(over: image)
            }
            context.render(image, to: pixels, bounds: bounds, colorSpace: CGColorSpace(name: CGColorSpace.sRGB))
            output.stream.send(try format.sample(pixels, at: now), discontinuity: [], hostTimeInNanoseconds: UInt64(now.seconds * 1_000_000_000))
        } catch { clear() }
    }
    private func consume() {
        guard input.starts > 0, consumption == nil, let client = input.client else { return }
        let request = UUID()
        consumption = request
        let expected = generation
        input.stream.consumeSampleBuffer(from: client) { [weak self] sample, sequence, _, _, error in
            guard let self else { return }
            self.queue.async {
                guard self.consumption == request else { return }
                self.consumption = nil
                guard self.generation == expected, self.input.client?.clientID == client.clientID else { return }
                let now = CMClockGetTime(CMClockGetHostTimeClock())
                if error == nil, let sample, let pixels = CMSampleBufferGetImageBuffer(sample),
                   CVPixelBufferGetPixelFormatType(pixels) == kCVPixelFormatType_32BGRA,
                   CVPixelBufferGetWidth(pixels) == CameraFormat.all[self.input.activeIndex].width,
                   CVPixelBufferGetHeight(pixels) == CameraFormat.all[self.input.activeIndex].height {
                    self.latest = pixels; self.receivedAt = now.seconds
                    self.input.stream.notifyScheduledOutputChanged(CMIOExtensionScheduledOutput(sequenceNumber: sequence,
                        hostTimeInNanoseconds: UInt64(now.seconds * 1_000_000_000)))
                }
            }
        }
    }
}
