import AppKit
import ApplicationServices
import AVFoundation
import CaptureCore

/// Records activity and geometry only: never key codes, selected text, or entered text.
// Mutable sampling state is confined to queue; event monitor setup/teardown is MainActor-only.
final class InputJournal: @unchecked Sendable {
    private let queue = DispatchQueue(label: "smorec.input", qos: .utility)
    private let directory: URL?
    private let selected: SelectedSource
    private let options: CaptureOptions
    private let origin: CMTime
    private let cursorFile: FileHandle?
    private let activityFile: FileHandle?
    private var timer: DispatchSourceTimer?
    private var monitor: InputEventMonitor?
    private var bounds: CaptureRect
    private var windowVisible = true
    private var excludedApplications: Set<String>
    private var ownAppVisible: Bool
    private var whiteboardWindow: CGWindowID?
    private var whiteboardBounds: CGRect?
    private var whiteboardBoundsRead = 0.0
    private let onInput: (([String: Any]) -> Void)?
    private var lastBoundsRead = 0.0
    private var bytes = 0
    private var stopped = false
    private var lastTime = 0.0
    private var lastActivity = 0.0
    private var warningValues: [String] = []
    var warnings: [String] { queue.sync { warningValues } }

    static func requirePermissions(_ options: CaptureOptions) throws {
        try requireInputRecordingAccess(enabled: options.inputRecording != false,
            inputAllowed: CGPreflightListenEventAccess(), accessibilityAllowed: AXIsProcessTrusted())
    }

    init(directory: URL? = nil, selected: SelectedSource, options: CaptureOptions, origin: CMTime, onInput: (([String: Any]) -> Void)? = nil) throws {
        self.directory = directory; self.selected = selected; self.options = options; self.origin = origin
        bounds = selected.source.bounds
        self.onInput = onInput; excludedApplications = Set(options.excludedApplications ?? [])
        ownAppVisible = options.captureOwnApp == true && options.ownAppVisible == true
        guard let directory else { cursorFile = nil; activityFile = nil; return }
        let cursor = directory.appendingPathComponent("cursor.recovery.jsonl")
        let activity = directory.appendingPathComponent("input-activity.recovery.jsonl")
        guard !FileManager.default.fileExists(atPath: cursor.path), !FileManager.default.fileExists(atPath: activity.path),
              FileManager.default.createFile(atPath: cursor.path, contents: nil),
              FileManager.default.createFile(atPath: activity.path, contents: nil) else { throw CaptureFailure("输入轨迹文件已存在或无法创建") }
        cursorFile = try FileHandle(forWritingTo: cursor)
        activityFile = try FileHandle(forWritingTo: activity)
    }

    @MainActor func start() throws {
        let complete = options.inputRecording != false
        if complete { try Self.requirePermissions(options) }
        let monitor = InputEventMonitor { [weak self] point, typing, shortcut in
            guard let self else { return }
            self.queue.async {
                self.sample(point: point, click: !typing)
                if typing { self.activity(shortcut: shortcut) }
            }
        }
        if complete {
            if monitor.start() { self.monitor = monitor }
            else { throw CaptureFailure("无法记录点击与输入，请检查系统权限后重试，或关闭操作记录") }
        }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(16), leeway: .milliseconds(2))
        timer.setEventHandler { [weak self] in
            guard let self, let point = CGEvent(source: nil)?.location else { return }
            self.sample(point: point, click: false)
        }
        self.timer = timer; timer.resume()
    }

    private func time() -> Double { max(0, CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), origin).seconds) }

    private func sample(point: CGPoint, click: Bool) {
        guard !stopped else { return }
        let t = time()
        if let id = selected.windowID, t - lastBoundsRead > 0.1 {
            lastBoundsRead = t
            if let windows = CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]],
               let info = windows.first, let raw = info[kCGWindowBounds as String] as? [String: Any],
               let rect = CGRect(dictionaryRepresentation: raw as CFDictionary) {
                bounds = SourceCatalog.rect(rect)
                windowVisible = info[kCGWindowIsOnscreen as String] as? Bool ?? false
            } else { windowVisible = false }
        }
        let scale = selected.windowID == nil ? selected.scale : Double(selected.source.width) / max(1, bounds.width)
        let (x, y, inside) = normalizedPoint(x: point.x, y: point.y, bounds: bounds, crop: options.crop, scale: scale)
        let sample = CursorSample(t: max(lastTime, t), x: x, y: y,
            visible: inside && windowVisible && (!excludedForeground() || insideWhiteboard(point, at: t)),
            click: click, shape: CursorShape.current())
        lastTime = sample.t
        do {
            let data = try JSONEncoder().encode(sample)
            if let cursorFile { try append(data, to: cursorFile) }
            if let cursor = try JSONSerialization.jsonObject(with: data) as? [String: Any] { onInput?(["cursor": cursor]) }
        }
        catch { inputFailure(error) }
    }

    private func activity(shortcut: Bool) {
        let t = time()
        guard !stopped, t - lastActivity > 0.05 else { return }
        lastActivity = t
        let reset = shortcut || excludedForeground() || !windowVisible
        var value: [String: Any] = ["t": t, "kind": reset ? "reset" : "typing"]
        if !reset, let focus = FocusLocator.position() {
            let (x, y, inside) = normalizedPoint(x: focus.x, y: focus.y, bounds: bounds, crop: options.crop, scale: selected.windowID == nil ? selected.scale : Double(selected.source.width) / max(1, bounds.width))
            if inside { value["focus"] = ["x": x, "y": y] }
            else { value["kind"] = "reset" }
        }
        do {
            if let activityFile { try append(try JSONSerialization.data(withJSONObject: value), to: activityFile) }
            onInput?(["activity": value])
        }
        catch { inputFailure(error) }
    }

    func updateExclusions(_ ids: [String]) {
        queue.sync { excludedApplications = Set(ids); onInput?(["activity": ["t": time(), "kind": "reset"]]) }
    }
    func setOwnAppVisible(_ visible: Bool) {
        queue.sync { ownAppVisible = visible; onInput?(["activity": ["t": time(), "kind": "reset"]]) }
    }

    func includeWhiteboard(_ id: CGWindowID?) {
        queue.sync { whiteboardWindow = id; whiteboardBounds = nil; whiteboardBoundsRead = 0 }
    }

    private func insideWhiteboard(_ point: CGPoint, at time: Double) -> Bool {
        guard let id = whiteboardWindow,
              NSWorkspace.shared.frontmostApplication?.processIdentifier == SourceCatalog.parentPID else { return false }
        if whiteboardBounds == nil || time - whiteboardBoundsRead >= 0.1 {
            whiteboardBoundsRead = time
            let windows = CGWindowListCopyWindowInfo([.optionIncludingWindow], id) as? [[String: Any]]
            if let info = windows?.first, info[kCGWindowIsOnscreen as String] as? Bool == true,
               let raw = info[kCGWindowBounds as String] as? [String: Any] {
                whiteboardBounds = CGRect(dictionaryRepresentation: raw as CFDictionary)
            } else { whiteboardBounds = nil }
        }
        return whiteboardBounds?.contains(point) == true
    }

    private func excludedForeground() -> Bool {
        guard let app = NSWorkspace.shared.frontmostApplication else { return false }
        return app.processIdentifier == SourceCatalog.parentPID ? !ownAppVisible : excludedApplications.contains(app.bundleIdentifier ?? "")
    }

    private func append(_ data: Data, to file: FileHandle) throws {
        guard bytes + data.count < 120 * 1024 * 1024 else { throw CaptureFailure("输入轨迹达到安全大小上限，视频录制继续") }
        try file.write(contentsOf: data + Data([10])); bytes += data.count + 1
    }
    private func inputFailure(_ error: Error) {
        if !warningValues.contains(error.localizedDescription) { warningValues.append(error.localizedDescription) }
        stopped = true; timer?.cancel()
    }

    @MainActor func finish(duration: Double) async throws {
        monitor?.stop(); monitor = nil
        timer?.cancel(); timer = nil
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    self.stopped = true
                    try self.cursorFile?.close(); try self.activityFile?.close()
                    try self.finalize("cursor", duration: duration)
                    try self.finalize("input-activity", duration: duration)
                    continuation.resume()
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    private func finalize(_ name: String, duration: Double) throws {
        guard let directory else { return }
        let data = try Data(contentsOf: directory.appendingPathComponent("\(name).recovery.jsonl"))
        let lines = data.split(separator: 10).filter { line in
            guard let value = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let time = value["t"] as? Double else { return false }
            return time <= duration
        }
        var output = Data([91])
        for (index, line) in lines.enumerated() { if index > 0 { output.append(44) }; output.append(contentsOf: line) }
        output.append(93)
        try output.write(to: directory.appendingPathComponent("\(name).json"), options: .atomic)
    }
}
