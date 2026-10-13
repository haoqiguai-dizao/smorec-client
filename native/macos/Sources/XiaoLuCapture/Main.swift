import AppKit
import AVFoundation
import CaptureCore

@main struct CaptureHost {
    @MainActor static func main() async {
        signal(SIGPIPE, SIG_IGN)
        do { try ProtocolSocket.connectIfRequested() }
        catch { FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8)); return }
        // A Launch Services agent must finish its launch handshake before its caller receives the PID.
        // It has no windows; async stdin processing keeps the main actor available.
        if CommandLine.arguments.contains(where: { $0.hasPrefix("--protocol-socket=") }) {
            let application = NSApplication.shared
            application.setActivationPolicy(.accessory)
            application.finishLaunching()
        }
        // Initialize the display connection before a fresh window-only SCContentFilter.
        _ = CGMainDisplayID()
        var session: RecordingSession?
        var trial: MicrophoneTrial?
        var live: LiveSession?
        let lines = AsyncStream<String> { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                while let line = readLine() {
                    if line.utf8.count <= 65536 { continuation.yield(line) }
                    else { Wire.send(["id": NSNull(), "ok": false, "error": "采集命令超过大小上限"]) }
                }
                continuation.finish()
            }
        }
        for await line in lines {
            var id: String?
            do {
                guard let data = line.data(using: .utf8), let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let identifier = raw["id"] as? String, let name = raw["command"] as? String else { throw CaptureFailure("采集命令格式无效") }
                id = identifier
                var result: Any = [:]
                switch name {
                case "capabilities":
                    let microphoneAccess = AVCaptureDevice.authorizationStatus(for: .audio)
                    let access = microphoneAccess == .authorized ? "granted" : microphoneAccess == .notDetermined ? "not-determined"
                        : microphoneAccess == .restricted ? "restricted" : microphoneAccess == .denied ? "denied" : "unknown"
                    result = ["platform": "darwin", "protocol": 1,
                              "permissionIdentity": Bundle.main.bundleIdentifier ?? "unbundled", "permissionPID": getpid(),
                              "screenPermission": CGPreflightScreenCaptureAccess(),
                              "microphonePermission": microphoneAccess == .authorized, "microphoneAuthorization": access,
                              "inputPermission": CGPreflightListenEventAccess(), "accessibilityPermission": AXIsProcessTrusted()]
                case "request-microphone":
                    if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
                        result = ["granted": await AVCaptureDevice.requestAccess(for: .audio)]
                    } else { result = ["granted": AVCaptureDevice.authorizationStatus(for: .audio) == .authorized] }
                case "request-screen": result = ["granted": CGRequestScreenCaptureAccess()]
                case "request-input": result = ["granted": CGRequestListenEventAccess()]
                case "request-accessibility":
                    // Request from the same executable that reads focus geometry.
                    result = ["granted": AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)]
                case "sources": result = try Wire.object(await SourceCatalog.sources())
                case "microphone-devices": result = SourceCatalog.microphones()
                case "camera-status": result = SourceCatalog.cameraStatus()
                case "permission-settings-window": result = PermissionSettingsWindow.bounds()
                case "live-applications": result = try await SourceCatalog.applications()
                case "live-start":
                    guard session == nil, trial == nil, live == nil, let options = raw["options"], let pipeName = raw["pipeName"] as? String else {
                        throw CaptureFailure("请先结束当前采集或检查直播参数")
                    }
                    let settings = try JSONDecoder().decode(CaptureOptions.self, from: JSONSerialization.data(withJSONObject: options))
                    let selected = try await SourceCatalog.select(settings)
                    let capture = try LiveSession(options: settings, selected: selected, pipeName: pipeName)
                    live = capture
                    do { result = try await capture.start() }
                    catch { live = nil; throw error }
                case "live-exclusions":
                    guard let live, let ids = raw["excludedApplications"] as? [String] else { throw CaptureFailure("直播排除应用参数无效") }
                    try await live.exclusions(ids)
                case "live-audio":
                    guard let live, let values = raw["options"] as? [String: Any],
                          let system = values["system"] as? Bool, let microphone = values["microphone"] as? Bool else {
                        throw CaptureFailure("直播声音参数无效")
                    }
                    result = try await live.setAudio(system: system, microphone: microphone)
                case "live-whiteboard":
                    guard let live, let id = raw["windowId"] as? UInt32, id > 0,
                          let visible = raw["visible"] as? Bool else { throw CaptureFailure("白板直播参数无效") }
                    try await live.setWhiteboard(windowID: id, visible: visible)
                case "recording-exclusions":
                    guard let session, let ids = raw["excludedApplications"] as? [String] else { throw CaptureFailure("录制排除应用参数无效") }
                    try await session.exclusions(ids)
                    result = ["applied": true]
                case "live-demo":
                    guard let live, let visible = raw["visible"] as? Bool else { throw CaptureFailure("演示投屏参数无效") }
                    try await live.setDemoVisible(visible)
                    result = ["cameraIndependent": true]
                case "live-stop":
                    if let live { await live.stop() }; live = nil
                case "start", "prepare-recording":
                    guard session == nil, trial == nil, live == nil, let options = raw["options"] else { throw CaptureFailure("已有录制或录制参数无效") }
                    let settings = try JSONDecoder().decode(CaptureOptions.self, from: JSONSerialization.data(withJSONObject: options))
                    let selected = try await SourceCatalog.select(settings)
                    let recording = try RecordingSession(directory: Wire.directory(raw["directory"] as? String), options: settings, selected: selected)
                    session = recording
                    do { result = try await recording.start(awaitCamera: name == "prepare-recording") }
                    catch { session = nil; throw error }
                case "begin-recording":
                    guard let recording = session else { throw CaptureFailure("录制尚未准备") }
                    do { result = try await recording.beginRecording() }
                    catch { session = nil; throw error }
                case "whiteboard-presentation":
                    guard let session, let id = raw["windowId"] as? UInt32, id > 0,
                          let visible = raw["visible"] as? Bool else { throw CaptureFailure("白板采集请求无效") }
                    try await session.setWhiteboard(windowID: id, visible: visible)
                    result = ["ready": true]
                case "audio-mute":
                    guard let session, let values = raw["options"] as? [String: Any] else { throw CaptureFailure("当前没有正在录制的工程") }
                    result = session.mute(values)
                case "recording-audio":
                    guard let session, let values = raw["options"] as? [String: Any] else { throw CaptureFailure("当前没有正在录制的工程") }
                    result = try await session.selectAudio(values)
                case "recording-demo":
                    guard let session, let visible = raw["visible"] as? Bool else { throw CaptureFailure("演示录制参数无效") }
                    result = ["time": try await session.setDemoVisible(visible), "cameraIndependent": true]
                case "stop":
                    guard let recording = session else { throw CaptureFailure("当前没有正在录制的工程") }
                    do { result = try await recording.stop(); session = nil }
                    catch { session = nil; throw error }
                case "recording-dictation-start", "recording-dictation-stop", "recording-dictation-cancel":
                    guard let session, let clip = raw["dictationId"] as? String, UUID(uuidString: clip) != nil else {
                        throw CaptureFailure("录制语音会话已失效")
                    }
                    if name == "recording-dictation-start" {
                        try session.startDictation(id: clip, directory: Wire.directory(raw["directory"] as? String))
                        result = ["ready": true]
                    } else if name == "recording-dictation-stop" { result = try session.stopDictation(id: clip) }
                    else { session.cancelDictation(id: clip) }
                case "microphone-trial-start", "dictation-start":
                    guard session == nil, trial == nil, live == nil else { throw CaptureFailure("请先结束当前录制") }
                    let clip = name == "dictation-start" ? raw["dictationId"] as? String : nil
                    let recording = try MicrophoneTrial(directory: Wire.directory(raw["directory"] as? String),
                        maximumDuration: name == "dictation-start" ? 30 : 10, onLevel: { level in
                            if let clip { Wire.send(["event": "dictation-level", "dictationId": clip, "level": level]) }
                        })
                    trial = recording
                    do { try await recording.start(deviceID: raw["deviceId"] as? String); result = ["ready": true] }
                    catch { trial = nil; throw error }
                case "microphone-trial-stop", "dictation-stop":
                    guard let recording = trial else { throw CaptureFailure("麦克风试录已结束") }
                    do { result = try await recording.stop(); trial = nil }
                    catch { trial = nil; throw error }
                default: throw CaptureFailure("当前 Mac 采集组件不支持命令：\(name)")
                }
                Wire.send(["id": identifier, "ok": true, "data": result])
            } catch { Wire.send(["id": id as Any? ?? NSNull(), "ok": false, "error": error.localizedDescription]) }
        }
        if let session { _ = try? await session.stop() }
        if let trial { _ = try? await trial.stop() }
        if let live { await live.stop() }
    }
}
