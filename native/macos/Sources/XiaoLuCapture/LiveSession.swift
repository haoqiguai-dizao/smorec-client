import AVFoundation
import ScreenCaptureKit
import CaptureCore

final class LiveSession: NSObject, SCStreamOutput, SCStreamDelegate {
    private let queue = DispatchQueue(label: "smorec.live-capture", qos: .userInitiated)
    private var options: CaptureOptions
    private let selected: SelectedSource
    private let frames: FrameServer
    private let audio: LiveAudio?
    private var lastMicrophone: CMTime?
    private var watchdog: DispatchSourceTimer?
    private var stream: SCStream?
    private var independentInput: HALMicrophoneCapture?
    private var independentMicrophone = false
    private var journal: InputJournal?
    private var origin: CMTime?
    private var failure: Error?
    private var stopped = false
    private var includedWhiteboard: CGWindowID?
    private var knownWhiteboard: CGWindowID?
    let width: Int
    let height: Int

    init(options: CaptureOptions, selected: SelectedSource, pipeName: String) throws {
        guard options.liveAudio == true || !options.systemAudio && !options.microphone else { throw CaptureFailure("虚拟摄像头模式不传输声音") }
        self.options = options; self.selected = selected
        (width, height) = try options.dimensions(sourceWidth: selected.source.width, sourceHeight: selected.source.height)
        let mixer = options.liveAudio == true ? LiveAudio(system: options.systemAudio, microphone: options.microphone) : nil
        audio = mixer
        frames = try FrameServer(name: pipeName, width: width, height: height, audio: mixer)
    }

    func start() async throws -> [String: Any] {
        try InputJournal.requirePermissions(options)
        if options.microphone {
            guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
                throw CaptureFailure("请在系统设置 → 隐私与安全性 → 麦克风中允许小录")
            }
            if let id = options.microphoneDeviceId, !id.isEmpty,
               !SourceCatalog.microphones().contains(where: { $0["id"] as? String == id }) { throw CaptureFailure("所选麦克风已断开，请重新选择") }
        }
        independentMicrophone = try options.microphone && CoreAudioInputDevice.needsIndependentInput(options.microphoneDeviceId)
        let config = configuration(options, independent: independentMicrophone)
        let capture = SCStream(filter: selected.filter, configuration: config, delegate: self)
        stream = capture
        do {
            if independentMicrophone { try await startIndependentMicrophone() }
            try capture.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
            if audio != nil {
                try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
                try capture.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
            }
            try await capture.startCapture()
            let deadline = ContinuousClock.now + .seconds(8)
            while ContinuousClock.now < deadline {
                let state = queue.sync { (origin, failure, !options.microphone || (audio?.microphonePackets ?? 0) > 0) }
                if let failure = state.1 { throw failure }
                if let origin = state.0, state.2 {
                    let journal = try InputJournal(selected: selected, options: options, origin: origin,
                        onInput: { Wire.send(["event": "live-input", "data": [$0]]) })
                    self.journal = journal
                    try await journal.start()
                    monitorMicrophone()
                    let timestamp = Date().timeIntervalSince1970 * 1000
                        - CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), origin).seconds * 1000
                    return ["width": width, "height": height, "warnings": journal.warnings, "startedAtUnixMs": timestamp, "cameraIndependent": true]
                }
                try await Task.sleep(for: .milliseconds(25))
            }
            throw CaptureFailure("直播来源没有返回有效画面")
        } catch { await stop(); throw error }
    }

    private func configuration(_ options: CaptureOptions, independent: Bool) -> SCStreamConfiguration {
        let config = SCStreamConfiguration()
        config.width = width; config.height = height
        config.minimumFrameInterval = CMTime(value: 1, timescale: Int32(options.fps))
        config.queueDepth = 3; config.showsCursor = false
        config.pixelFormat = kCVPixelFormatType_32BGRA; config.captureDynamicRange = .SDR
        config.capturesAudio = options.systemAudio; config.excludesCurrentProcessAudio = true
        config.sampleRate = 48000; config.channelCount = 2; config.captureMicrophone = options.microphone && !independent
        if let id = options.microphoneDeviceId, !id.isEmpty { config.microphoneCaptureDeviceID = id }
        if let crop = options.crop {
            config.sourceRect = CGRect(x: crop.x / selected.scale, y: crop.y / selected.scale,
                                       width: crop.width / selected.scale, height: crop.height / selected.scale)
        }
        return config
    }

    private func startIndependentMicrophone() async throws {
        let input = HALMicrophoneCapture(deviceID: options.microphoneDeviceId, delivery: queue,
            receive: { [weak self] sample in self?.receiveAudio(sample, microphone: true) },
            fail: { [weak self] error in
                guard let self, !self.stopped else { return }
                self.failure = error
                Wire.send(["event": "live-error", "error": error.localizedDescription])
            })
        independentInput = input
        try await input.start()
    }

    func setAudio(system: Bool, microphone: Bool) async throws -> [String: Bool] {
        guard let stream, let audio, !queue.sync(execute: { stopped }) else { throw CaptureFailure("直播声音已结束") }
        if microphone {
            guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
                throw CaptureFailure("请在系统设置 → 隐私与安全性 → 麦克风中允许小录")
            }
            if let id = options.microphoneDeviceId, !id.isEmpty,
               !SourceCatalog.microphones().contains(where: { $0["id"] as? String == id }) { throw CaptureFailure("所选麦克风已断开") }
        }
        let previous = options
        let previousIndependent = independentMicrophone
        let nextIndependent = try microphone && CoreAudioInputDevice.needsIndependentInput(options.microphoneDeviceId)
        var next = previous; next.systemAudio = system; next.microphone = microphone
        let packets = queue.sync { audio.microphonePackets }
        do {
            if nextIndependent && independentInput == nil { try await startIndependentMicrophone() }
            try await stream.updateConfiguration(configuration(next, independent: nextIndependent))
            queue.sync { options = next; independentMicrophone = nextIndependent; lastMicrophone = nil }
            if microphone && !previous.microphone {
                let deadline = ContinuousClock.now + .seconds(3)
                while queue.sync(execute: { audio.microphonePackets <= packets }) {
                    guard ContinuousClock.now < deadline else { throw CaptureFailure("麦克风没有返回声音，请检查设备") }
                    try await Task.sleep(for: .milliseconds(25))
                }
            }
            audio.setEnabled(system: system, microphone: microphone)
            if !nextIndependent { await independentInput?.stop(); independentInput = nil }
            return ["system": system, "microphone": microphone]
        } catch {
            try? await stream.updateConfiguration(configuration(previous, independent: previousIndependent))
            queue.sync { options = previous; independentMicrophone = previousIndependent }
            if !previousIndependent { await independentInput?.stop(); independentInput = nil }
            audio.setEnabled(system: previous.systemAudio, microphone: previous.microphone)
            throw error
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if !stopped, sampleBuffer.isValid, type == .audio || type == .microphone {
            receiveAudio(sampleBuffer, microphone: type == .microphone)
            return
        }
        guard !stopped, sampleBuffer.isValid, type == .screen,
              let metadata = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              metadata.first?[.status] as? Int == SCFrameStatus.complete.rawValue,
              let pixel = sampleBuffer.imageBuffer else { return }
        if origin == nil { origin = sampleBuffer.presentationTimeStamp }
        frames.publish(pixel, origin: origin!)
    }

    private func receiveAudio(_ sample: CMSampleBuffer, microphone: Bool) {
        guard !stopped, sample.isValid, let origin, let audio,
              microphone ? options.microphone : options.systemAudio else { return }
        do {
            try audio.append(sample, origin: origin, track: microphone ? 1 : 0)
            if microphone { lastMicrophone = CMClockGetTime(CMClockGetHostTimeClock()) }
        } catch { failure = error; Wire.send(["event": "live-error", "error": error.localizedDescription]) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        queue.async {
            guard !self.stopped else { return }
            self.failure = error
            Wire.send(["event": "live-error", "error": error.localizedDescription])
            Task { await self.stop() }
        }
    }

    private func monitorMicrophone() {
        guard audio != nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 2, repeating: 2)
        timer.setEventHandler { [weak self] in
            guard let self, !self.stopped, self.options.microphone, let last = self.lastMicrophone else { return }
            if CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), last).seconds > 3 {
                self.watchdog?.cancel(); self.watchdog = nil
                Wire.send(["event": "live-error", "error": "直播麦克风停止更新，请检查设备后重新开始"])
            }
        }
        watchdog = timer; timer.resume()
    }

    func setDemoVisible(_ visible: Bool) async throws {
        guard selected.windowID == nil,
              !queue.sync(execute: { stopped }), let stream else { throw CaptureFailure("演示投屏尚未开始或已经结束") }
        var next = options
        next.captureOwnApp = true; next.ownAppVisible = visible
        let source = try await SourceCatalog.select(next, includingWindowID: includedWhiteboard,
            excludingWindowID: includedWhiteboard == nil ? knownWhiteboard : nil)
        try await stream.updateContentFilter(source.filter)
        frames.clear()
        journal?.setOwnAppVisible(visible)
        options = next
    }
    func setWhiteboard(windowID: CGWindowID, visible: Bool) async throws {
        if selected.windowID != nil && !visible { return }
        guard selected.windowID == nil, let stream, !queue.sync(execute: { stopped }) else {
            throw CaptureFailure("完整白板界面请使用屏幕或区域直播")
        }
        let next: CGWindowID? = visible ? windowID : nil
        let source = try await SourceCatalog.select(options, includingWindowID: next,
            excludingWindowID: next == nil ? windowID : nil)
        try await stream.updateContentFilter(source.filter)
        frames.clear(); includedWhiteboard = next; knownWhiteboard = windowID; journal?.includeWhiteboard(next)
    }
    func exclusions(_ ids: [String]) async throws {
        guard !queue.sync(execute: { stopped }), let stream else { throw CaptureFailure("直播已结束") }
        var updated = options
        updated.excludedApplications = try validatedApplicationIDs(ids)
        let source = try await SourceCatalog.select(updated, includingWindowID: includedWhiteboard,
            excludingWindowID: includedWhiteboard == nil ? knownWhiteboard : nil)
        // Prevent retained pixels/input from the prior filter leaking after the update returns.
        try await stream.updateContentFilter(source.filter)
        frames.clear()
        journal?.updateExclusions(updated.excludedApplications!)
        options = updated
    }

    func stop() async {
        let alreadyStopped = queue.sync { let previous = stopped; stopped = true; return previous }
        guard !alreadyStopped else { return }
        queue.sync { watchdog?.cancel(); watchdog = nil }
        frames.stop()
        if let stream { try? await stream.stopCapture() }; stream = nil
        await independentInput?.stop(); independentInput = nil
        try? await journal?.finish(duration: .greatestFiniteMagnitude)
        journal = nil
    }
}
