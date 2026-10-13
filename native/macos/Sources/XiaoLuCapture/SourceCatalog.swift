import AppKit
import AVFoundation
import CoreAudio
import ScreenCaptureKit
import CaptureCore

struct SelectedSource {
    let source: CaptureSource
    let filter: SCContentFilter
    let scale: Double
    let windowID: CGWindowID?
}

enum SourceCatalog {
    static var parentPID: pid_t { pid_t(ProcessInfo.processInfo.environment["FRAMEFLOW_PARENT_PID"] ?? "") ?? getppid() }

    static func content(includingWhiteboardID: CGWindowID? = nil, includeOffscreen: Bool = false) async throws -> SCShareableContent {
        guard CGPreflightScreenCaptureAccess() else {
            throw CaptureFailure("请先在小录授权页完成屏幕录制权限，再选择录制画面")
        }
        let read = {
            try await SCShareableContent.excludingDesktopWindows(false,
                onScreenWindowsOnly: includingWhiteboardID == nil && !includeOffscreen)
        }
        guard let id = includingWhiteboardID else { return try await read() }
        // Only the main process supplies this ID; retain the ownership check even
        // when enumerating windows whose show transition has not completed yet.
        return try await WhiteboardReadiness.wait {
            let snapshot = try await read()
            guard snapshot.windows.contains(where: {
                $0.windowID == id && $0.owningApplication?.processID == parentPID
            }) else { return nil }
            return snapshot
        }
    }

    static func rect(_ r: CGRect) -> CaptureRect {
        CaptureRect(x: r.minX, y: r.minY, width: r.width, height: r.height)
    }

    static func displaySource(_ display: SCDisplay, index: Int) -> CaptureSource {
        // CGDisplayPixelsWide reports logical pixels for scaled Retina display modes.
        let scale = CGFloat(SCContentFilter(display: display, excludingWindows: []).pointPixelScale)
        let width = Int(display.frame.width * scale), height = Int(display.frame.height * scale)
        return CaptureSource(id: "screen:\(display.displayID)", kind: "screen", name: "显示器 \(index + 1)",
                             width: width, height: height, bounds: rect(display.frame))
    }

    static func windowSource(_ window: SCWindow) -> CaptureSource {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        return CaptureSource(id: "window:\(window.windowID)", kind: "window",
                             name: window.title?.isEmpty == false ? window.title! : window.owningApplication?.applicationName ?? "窗口",
                             width: Int(filter.contentRect.width * CGFloat(filter.pointPixelScale)),
                             height: Int(filter.contentRect.height * CGFloat(filter.pointPixelScale)), bounds: rect(window.frame))
    }

    static func sources() async throws -> [CaptureSource] {
        let content = try await content()
        return content.displays.enumerated().map { displaySource($0.element, index: $0.offset) }
        + content.windows.filter { $0.owningApplication?.processID != parentPID && $0.windowLayer == 0
            && $0.frame.width >= 32 && $0.frame.height >= 32 }.map(windowSource)
    }

    static func select(_ options: CaptureOptions, includingWindowID: CGWindowID? = nil,
                       excludingWindowID: CGWindowID? = nil) async throws -> SelectedSource {
        let content = try await content(includingWhiteboardID: includingWindowID ?? excludingWindowID,
            includeOffscreen: options.captureOwnApp == true && options.ownAppVisible == true)
        if let index = content.displays.firstIndex(where: { "screen:\($0.displayID)" == options.sourceId }) {
            let display = content.displays[index]
            let ids = try validatedApplicationIDs(options.excludedApplications ?? [])
            let showOwnApp = options.captureOwnApp == true && options.ownAppVisible == true
            let excluded = content.applications.filter {
                ($0.processID == parentPID && !showOwnApp) || ($0.processID != parentPID && ids.contains($0.bundleIdentifier))
            }
            guard content.applications.contains(where: { $0.processID == parentPID }) else {
                throw CaptureFailure("无法确认小录窗口的采集排除身份，请重新打开录制栏")
            }
            // Default: exclude the app, with only the trusted whiteboard as an exception.
            // Demo includes app UI while keeping the local camera preview out of the screen track.
            var included: [SCWindow] = []
            if let id = includingWindowID ?? excludingWindowID {
                guard let window = content.windows.first(where: { $0.windowID == id }),
                      window.owningApplication?.processID == parentPID else {
                    throw CaptureFailure("白板窗口尚未就绪，请重新打开白板")
                }
                // Demo shows the actual board interface, including its local alpha.
                // Normal capture may include only a trusted board UI exception.
                if includingWindowID != nil && !showOwnApp { included = [window] }
            }
            // exceptingWindows reverses the app rule: these included-app windows are excluded.
            included += content.windows.filter {
                CameraCapturePolicy.excludesPreview(showOwnApp: showOwnApp,
                    owningPID: $0.owningApplication?.processID, parentPID: parentPID, title: $0.title)
            }
            let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: included)
            let source = displaySource(display, index: index)
            return SelectedSource(source: source, filter: filter, scale: Double(source.width) / display.frame.width, windowID: nil)
        }
        if options.captureOwnApp == true { throw CaptureFailure("演示全部界面请使用屏幕或区域采集") }
        guard let window = content.windows.first(where: { "window:\($0.windowID)" == options.sourceId }),
              window.owningApplication?.processID != parentPID else { throw CaptureFailure("录制来源已关闭，请重新选择") }
        let ids = try validatedApplicationIDs(options.excludedApplications ?? [])
        guard !ids.contains(window.owningApplication?.bundleIdentifier ?? "") else {
            throw CaptureFailure("当前采集窗口所属应用已被排除，请选择其他来源或取消排除")
        }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        return SelectedSource(source: windowSource(window), filter: filter, scale: Double(filter.pointPixelScale), windowID: window.windowID)
    }

    static func applications() async throws -> [[String: Any]] {
        let content = try await content()
        let visible = Set(content.windows.filter { $0.windowLayer == 0 }.compactMap { $0.owningApplication?.processID })
        var seen = Set<String>()
        return content.applications.compactMap { app in
            guard app.processID != parentPID, visible.contains(app.processID),
                  (try? validatedApplicationIDs([app.bundleIdentifier])) != nil,
                  seen.insert(app.bundleIdentifier).inserted else { return nil }
            return ["id": app.bundleIdentifier, "name": app.applicationName, "executable": app.bundleIdentifier]
        }
    }

    static func microphones() -> [[String: Any]] {
        let preferred = AVCaptureDevice.default(for: .audio)?.uniqueID
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: [.microphone, .external], mediaType: .audio, position: .unspecified).devices
        return devices.map { device in
            let kind: String
            switch UInt32(bitPattern: device.transportType) {
            case kAudioDeviceTransportTypeBluetooth, kAudioDeviceTransportTypeBluetoothLE: kind = "bluetooth"
            case kAudioDeviceTransportTypeUSB: kind = "usb"
            case kAudioDeviceTransportTypeBuiltIn: kind = "builtin"
            default: kind = "other"
            }
            return ["id": device.uniqueID, "name": device.localizedName, "isDefault": device.uniqueID == preferred, "transport": kind]
        }
    }

    static func cameraStatus() -> [String: Any] {
        // Discovery does not request permission or open a video stream. A connected
        // built-in camera can be suspended (for example while the laptop is closed).
        let devices = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera, .deskViewCamera],
            mediaType: .video, position: .unspecified).devices.filter { $0.isConnected }
        return ["availableCount": devices.filter { !$0.isSuspended }.count,
                "suspendedCount": devices.filter { $0.isSuspended }.count,
                "builtInSuspended": devices.contains { $0.deviceType == .builtInWideAngleCamera && $0.isSuspended }]
    }
}
