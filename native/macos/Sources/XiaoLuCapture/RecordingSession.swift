import AVFoundation
import ScreenCaptureKit
import CaptureCore

final class RecordingSession: NSObject, SCStreamOutput, SCStreamDelegate {
    let queue = DispatchQueue(label: "smorec.capture", qos: .userInitiated)
    let directory: URL
    private var options: CaptureOptions
    let selected: SelectedSource
    let width: Int
    let height: Int
    private var stream: SCStream?
    private var video: VideoTrack?
    private var system: RecordingAudioTrack?
    private var microphone: RecordingAudioTrack?
    private var independentInput: HALMicrophoneCapture?
    private var selectedInput: PreparedMicrophoneInput?
    private var configuration: SCStreamConfiguration?
    private var microphoneFromStream = true
    private var microphoneRevision = 0
    private var dictation: DictationTrack?
    private var inputJournal: InputJournal?
    private var whiteboard: WhiteboardCapture?
    private var includedWhiteboard: CGWindowID?
    private var knownWhiteboard: CGWindowID?
    private var awaitingCamera = false
    private var preparedScreen = false
    private var origin: CMTime?
    private var failure: Error?
    private var ending = false
    private var microphoneBuffers = 0
    private var lastMicrophone: CMTime?
    private var watchdog: DispatchSourceTimer?
    private var startedAt: Double = 0
    private var result: [String: Any]?
    private var finishTask: Task<[String: Any], Error>?

    init(directory: URL, options: CaptureOptions, selected: SelectedSource) throws {
        self.directory = directory; self.options = options; self.selected = selected
        (width, height) = try options.dimensions(sourceWidth: selected.source.width, sourceHeight: selected.source.height)
    }

    func start(awaitCamera: Bool = false) async throws -> [String: Any] {
        try InputJournal.requirePermissions(options)
        awaitingCamera = awaitCamera
        if options.microphone {
            guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
                throw CaptureFailure("请在系统设置 → 隐私与安全性 → 麦克风中允许小录")
            }
            if let id = options.microphoneDeviceId, !id.isEmpty,
               !SourceCatalog.microphones().contains(where: { $0["id"] as? String == id }) {
                throw CaptureFailure("所选麦克风已断开，请重新选择")
            }
        }
        video = try VideoTrack(url: directory.appendingPathComponent("screen.mp4"), width: width, height: height, fps: options.fps)
        if options.systemAudio {
            system = try makeAudioTrack("system.wav")
        }
        if options.microphone {
            microphone = try makeAudioTrack("microphone.wav")
        }
        let config = SCStreamConfiguration()
        configuration = config
        config.width = width; config.height = height
        config.minimumFrameInterval = CMTime(value: 1, timescale: Int32(options.fps))
        config.queueDepth = 5; config.showsCursor = false
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.captureDynamicRange = .SDR
        config.capturesAudio = options.systemAudio; config.excludesCurrentProcessAudio = true
        config.sampleRate = 48000; config.channelCount = 2
        let independentMicrophone = try options.microphone && CoreAudioInputDevice.needsIndependentInput(options.microphoneDeviceId)
        config.captureMicrophone = options.microphone && !independentMicrophone
        if let id = options.microphoneDeviceId, !id.isEmpty { config.microphoneCaptureDeviceID = id }
        if let crop = options.crop {
            config.sourceRect = CGRect(x: crop.x / selected.scale, y: crop.y / selected.scale,
                                       width: crop.width / selected.scale, height: crop.height / selected.scale)
        }
        let stream = SCStream(filter: selected.filter, configuration: config, delegate: self)
        self.stream = stream
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        try stream.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
        do {
            if independentMicrophone {
                let revision = microphoneRevision
                let input = HALMicrophoneCapture(deviceID: options.microphoneDeviceId, delivery: queue,
                    receive: { [weak self] in if self?.microphoneRevision == revision { self?.receiveMicrophone($0) } },
                    fail: { [weak self] in if self?.microphoneRevision == revision { self?.microphoneInterrupted($0) } })
                independentInput = input
                try await input.start()
            }
            try await startCapture(stream)
            return try await waitForStart(preparing: awaitCamera)
        } catch {
            let shouldStopStream = queue.sync {
                watchdog?.cancel(); watchdog = nil
                let failed = failure != nil
                ending = true
                return !failed
            }
            // didStopWithError already tears down the ScreenCaptureKit stream. Calling
            // stopCapture again while that callback is running can block the command
            // until the host timeout; the parent then only sees the generic “saving”
            // message and cannot retry. Let the failed session report immediately.
            if shouldStopStream { try? await stream.stopCapture() }
            await independentInput?.stop(); independentInput = nil
            if queue.sync(execute: { origin != nil }) { _ = try? await stop() }
            else { video?.cancel() }
            throw error
        }
    }

    /// Keep the already-open screen/microphone devices; only now admit samples to the files.
    func beginRecording() async throws -> [String: Any] {
        try queue.sync {
            guard awaitingCamera, !ending, failure == nil else { throw failure ?? CaptureFailure("录制准备状态无效") }
            awaitingCamera = false
            microphoneBuffers = 0
        }
        do { return try await waitForStart(preparing: false) }
        catch { _ = try? await stop(); throw error }
    }

    private func waitForStart(preparing: Bool) async throws -> [String: Any] {
        let deadline = ContinuousClock.now + .seconds(8)
        while ContinuousClock.now < deadline {
            let state = queue.sync {
                let screenReady = preparing ? preparedScreen : origin != nil
                let microphoneReady = !options.microphone || microphoneBuffers >= 2 && (preparing || microphone?.received == true)
                return (screenReady && microphoneReady, failure)
            }
            if let failure = state.1 { throw failure }
            if state.0 {
                if preparing { return ["prepared": true] }
                let journal = try InputJournal(directory: directory, selected: selected, options: options,
                                               origin: queue.sync { origin! })
                inputJournal = journal
                try await journal.start()
                monitorMicrophone()
                return ["startedAtUnixMs": startedAt, "warnings": journal.warnings, "cameraIndependent": true]
            }
            try await Task.sleep(for: .milliseconds(25))
        }
        throw CaptureFailure("屏幕或麦克风没有持续数据，请检查系统权限与设备后重试")
    }

    private func startCapture(_ stream: SCStream) async throws {
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await stream.startCapture() }
            group.addTask { [weak self] in
                while !Task.isCancelled {
                    if let failure = self?.queue.sync(execute: { self?.failure }) ?? nil { throw failure }
                    try await Task.sleep(for: .milliseconds(100))
                }
            }
            group.addTask {
                try await Task.sleep(for: .seconds(12))
                throw CaptureFailure("屏幕采集启动超时，请重新打开小录后重试")
            }
            defer { group.cancelAll() }
            try await group.next()
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard !ending, sampleBuffer.isValid else { return }
        if type == .microphone { if microphoneFromStream && options.microphone { receiveMicrophone(sampleBuffer) }; return }
        do {
            if type == .screen {
                guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
                      let status = attachments.first?[.status] as? Int,
                      status == SCFrameStatus.complete.rawValue, sampleBuffer.imageBuffer != nil else { return }
                preparedScreen = true
                guard !awaitingCamera else { return }
                if try video?.append(sampleBuffer) == true, origin == nil {
                    origin = sampleBuffer.presentationTimeStamp
                    startedAt = Date().timeIntervalSince1970 * 1000
                        - CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), origin!).seconds * 1000
                    let metadata: [String: Any] = ["createdAt": ISO8601DateFormatter().string(from: Date()),
                        "clockOrigin": 0, "startedAtUnixMs": startedAt, "options": ["fps": options.fps,
                        "systemAudio": options.systemAudio, "microphone": options.microphone]]
                    try JSONSerialization.data(withJSONObject: metadata).write(to: directory.appendingPathComponent("recording.recovery.json"), options: .atomic)
                }
            } else if !awaitingCamera, let origin {
                if type == .audio && options.systemAudio { try system?.append(sampleBuffer, origin: origin) }
            }
        } catch { failed(error) }
    }

    private func receiveMicrophone(_ sampleBuffer: CMSampleBuffer) {
        guard !ending, sampleBuffer.isValid else { return }
        if awaitingCamera { microphoneBuffers += 1; return }
        guard let origin else { return }
        do {
            dictation?.append(sampleBuffer)
            try microphone?.append(sampleBuffer, origin: origin)
            microphoneBuffers += 1; lastMicrophone = CMClockGetTime(CMClockGetHostTimeClock())
        } catch { failed(error) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { queue.async { self.failed(error) } }

    private func failed(_ error: Error) {
        guard failure == nil else { return }
        failure = error
        ending = true
        Wire.diagnostic(error.localizedDescription)
        // The parent owns the single stop/recovery path. Starting a second stop task
        // here races with start() and can leave the IPC request pending until timeout.
        Wire.send(["event": "state", "state": ["status": "error", "error": error.localizedDescription]])
    }

    private func monitorMicrophone() {
        guard options.microphone else { return }
        queue.sync {
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + 1, repeating: .seconds(1))
            timer.setEventHandler { [weak self] in
                guard let self, !self.ending, let last = self.lastMicrophone else { return }
                if CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), last).seconds > 3 {
                    self.microphoneInterrupted(CaptureFailure("麦克风连续三秒无数据"))
                }
            }
            watchdog = timer; timer.resume()
        }
    }

    func mute(_ values: [String: Any]) -> [String: Bool] {
        queue.sync {
            if let muted = values["microphoneMuted"] as? Bool { microphone?.muted = muted }
            if let muted = values["systemAudioMuted"] as? Bool { system?.muted = muted }
            return ["microphoneMuted": microphone?.muted ?? false, "systemAudioMuted": system?.muted ?? false]
        }
    }
    private func microphoneInterrupted(_ error: Error) {
        guard origin != nil else { failed(error); return }
        guard options.microphone, !ending else { return }
        options.microphone = false; microphone?.muted = true; dictation = nil; microphoneRevision += 1
        watchdog?.cancel(); watchdog = nil
        let warning = "麦克风已停止，屏幕录制继续；请重新选择设备：\(error.localizedDescription)"
        Wire.send(["event": "recording-audio-state", "state": ["microphoneEnabled": false,
            "microphoneMuted": true, "microphoneDeviceId": options.microphoneDeviceId ?? "",
            "systemAudioEnabled": options.systemAudio, "systemAudioMuted": system?.muted ?? false], "warning": warning])
        let selected = selectedInput, independent = independentInput
        Task { await selected?.stop(); await independent?.stop() }
    }
    func audioState() -> [String: Any] {
        queue.sync { ["microphoneEnabled": options.microphone, "microphoneMuted": microphone?.muted ?? false,
            "microphoneDeviceId": options.microphoneDeviceId ?? "", "systemAudioEnabled": options.systemAudio,
            "systemAudioMuted": system?.muted ?? false] }
    }
    private func makeAudioTrack(_ file: String) throws -> RecordingAudioTrack {
        let track = try RecordingAudioTrack(url: directory.appendingPathComponent(file))
        track.onFailure = { [weak self] error in self?.queue.async { [weak self] in self?.failed(error) } }
        return track
    }
    func selectAudio(_ values: [String: Any]) async throws -> [String: Any] {
        guard let stream, let configuration, let origin = queue.sync(execute: { ending ? nil : origin }) else {
            throw CaptureFailure("录制已停止")
        }
        guard queue.sync(execute: { dictation == nil }) else { throw CaptureFailure("请先松开语音录入，再调整麦克风") }
        if let enabled = values["systemAudioEnabled"] as? Bool {
            let previous = configuration.capturesAudio
            configuration.capturesAudio = enabled
            do { try await stream.updateConfiguration(configuration) }
            catch { configuration.capturesAudio = previous; try? await stream.updateConfiguration(configuration); throw error }
            do {
                try queue.sync {
                    guard !ending else { throw CaptureFailure("录制已停止") }
                    if enabled && system == nil { system = try makeAudioTrack("system.wav") }
                    let time = max(0, CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), origin).seconds)
                    system?.align(to: time); system?.muted = !enabled; options.systemAudio = enabled
                }
            } catch {
                configuration.capturesAudio = previous; try? await stream.updateConfiguration(configuration); throw error
            }
        }
        if let enabled = values["microphoneEnabled"] as? Bool {
            let id = values["microphoneDeviceId"] as? String ?? options.microphoneDeviceId ?? ""
            guard id.count <= 1024 else { throw CaptureFailure("麦克风设备参数无效") }
            guard !enabled || AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else { throw CaptureFailure("请先在系统设置允许麦克风") }
            let revision = queue.sync { microphoneRevision + 1 }
            let candidate = enabled ? PreparedMicrophoneInput(deviceID: id, queue: queue,
                receive: { [weak self] in if self?.microphoneRevision == revision { self?.receiveMicrophone($0) } },
                fail: { [weak self] in if self?.microphoneRevision == revision { self?.microphoneInterrupted($0) } }) : nil
            try await candidate?.prepare()
            let previousCapture = configuration.captureMicrophone
            configuration.captureMicrophone = false
            do { try await stream.updateConfiguration(configuration) }
            catch {
                configuration.captureMicrophone = previousCapture
                try? await stream.updateConfiguration(configuration); await candidate?.stop(); throw error
            }
            let previous = selectedInput, independent = independentInput
            do {
                try queue.sync {
                    guard !ending else { throw CaptureFailure("录制已停止") }
                    if enabled && microphone == nil { microphone = try makeAudioTrack("microphone.wav") }
                    try candidate?.commit()
                    microphoneRevision = revision
                    let time = max(0, CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), origin).seconds)
                    microphone?.align(to: time); microphone?.muted = !enabled
                    microphoneFromStream = false; options.microphone = enabled; options.microphoneDeviceId = id
                    watchdog?.cancel(); watchdog = nil; lastMicrophone = enabled ? CMClockGetTime(CMClockGetHostTimeClock()) : nil
                    selectedInput = candidate; independentInput = nil
                }
            } catch {
                configuration.captureMicrophone = previousCapture
                try? await stream.updateConfiguration(configuration); await candidate?.stop(); throw error
            }
            await previous?.stop(); await independent?.stop()
            if enabled { monitorMicrophone() }
        }
        return audioState()
    }

    func startDictation(id: String, directory: URL) throws {
        try queue.sync {
            guard !ending, origin != nil, options.microphone, failure == nil else {
                throw CaptureFailure("当前麦克风没有在录制，请检查录制栏的麦克风设置")
            }
            guard dictation == nil else { throw CaptureFailure("正在录入语音，请先松开鼠标") }
            dictation = try DictationTrack(id: id, directory: directory)
        }
    }
    func stopDictation(id: String) throws -> [String: Any] {
        try queue.sync {
            guard let clip = dictation, clip.id == id else { throw CaptureFailure("语音片段已结束") }
            defer { dictation = nil }
            return try clip.finish()
        }
    }
    func cancelDictation(id: String) {
        queue.sync { if dictation?.id == id { dictation = nil } }
    }

    func setDemoVisible(_ visible: Bool) async throws -> Double {
        guard selected.windowID == nil, let stream,
              let origin = queue.sync(execute: { ending ? nil : origin }) else {
            throw CaptureFailure("演示录制尚未开始或已经结束")
        }
        var next = options
        next.captureOwnApp = true; next.ownAppVisible = visible
        let source = try await SourceCatalog.select(next, includingWindowID: includedWhiteboard,
            excludingWindowID: includedWhiteboard == nil ? knownWhiteboard : nil)
        try await stream.updateContentFilter(source.filter)
        options = next
        inputJournal?.setOwnAppVisible(visible)
        return max(0, CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), origin).seconds)
    }
    func exclusions(_ ids: [String]) async throws {
        guard let stream, queue.sync(execute: { !ending && origin != nil && failure == nil }) else {
            throw CaptureFailure("只有正在录制时可以调整排除应用")
        }
        var next = options
        next.excludedApplications = try validatedApplicationIDs(ids)
        let source = try await SourceCatalog.select(next, includingWindowID: includedWhiteboard,
            excludingWindowID: includedWhiteboard == nil ? knownWhiteboard : nil)
        // Update the existing stream; keep the video writer, sound tracks and common clock running.
        try await stream.updateContentFilter(source.filter)
        inputJournal?.updateExclusions(next.excludedApplications!)
        options = next
    }

    func setWhiteboard(windowID: CGWindowID, visible: Bool) async throws {
        guard let stream, let origin = queue.sync(execute: { ending ? nil : origin }) else {
            throw CaptureFailure("录制尚未开始")
        }
        if selected.windowID == nil {
            if knownWhiteboard != windowID {
                // Normal capture excludes the local board; demo includes every visible app window.
                let source = try await SourceCatalog.select(options, excludingWindowID: windowID)
                try await stream.updateContentFilter(source.filter)
                includedWhiteboard = nil
                knownWhiteboard = windowID
                inputJournal?.includeWhiteboard(nil)
            }
        }
        // A bounded window track preserves the real controls while its capture background is white.
        if let whiteboard { try await whiteboard.setActive(visible); return }
        guard visible else { return }
        let capture = WhiteboardCapture(directory: directory, screenOrigin: origin)
        let scale = min(1, 2560.0 / Double(max(width, height)))
        let boardWidth = max(2, Int(Double(width) * scale) / 2 * 2)
        let boardHeight = max(2, Int(Double(height) * scale) / 2 * 2)
        try await capture.start(windowID: windowID, width: boardWidth, height: boardHeight, fps: min(30, options.fps))
        whiteboard = capture
    }

    func stop() async throws -> [String: Any] {
        let task: Task<[String: Any], Error> = queue.sync {
            if let task = finishTask { return task }
            let task = Task { try await self.finish() }
            finishTask = task
            return task
        }
        return try await task.value
    }

    private func finish() async throws -> [String: Any] {
        let end = CMClockGetTime(CMClockGetHostTimeClock())
        queue.sync { ending = true; dictation = nil; watchdog?.cancel(); watchdog = nil }
        if let stream { try? await stream.stopCapture() }
        await independentInput?.stop(); independentInput = nil
        await selectedInput?.stop(); selectedInput = nil
        self.stream = nil
        guard let origin = queue.sync(execute: { origin }), let video else {
            video?.cancel()
            throw CaptureFailure("录制尚未开始")
        }
        let duration = max(1 / Double(options.fps), CMTimeSubtract(end, origin).seconds)
        var warnings = inputJournal?.warnings ?? []
        if let whiteboard {
            do { warnings += try await whiteboard.finish(at: end) }
            catch { warnings.append("白板界面保存异常：\(error.localizedDescription)") }
        }
        if let failure = queue.sync(execute: { failure }) { warnings.append(failure.localizedDescription) }
        try await inputJournal?.finish(duration: duration)
        if inputJournal == nil { try Wire.write([CursorSample](), to: directory.appendingPathComponent("cursor.json")) }
        let videoDuration = try await video.finish(at: end)
        for track in [system, microphone].compactMap({ $0 }) {
            do { try await track.finish(duration: duration) }
            catch { warnings.append(error.localizedDescription) }
        }
        if video.dropped > 0 { warnings.append("编码繁忙期间跳过 \(video.dropped) 帧，原始时间戳已保留") }
        var result: [String: Any] = ["directory": directory.path, "duration": duration, "width": width, "height": height,
            "video": "screen.mp4", "cursor": "cursor.json", "startedAtUnixMs": startedAt, "warnings": warnings,
            "videoDuration": videoDuration, "tailHold": max(0, duration - videoDuration)]
        if system?.received == true { result["systemAudio"] = "system.wav" }
        if microphone?.received == true { result["microphone"] = "microphone.wav" }
        if inputJournal != nil { result["inputActivity"] = "input-activity.json" }
        try JSONSerialization.data(withJSONObject: result).write(to: directory.appendingPathComponent("recording.json"), options: .atomic)
        self.result = result
        return result
    }
}
