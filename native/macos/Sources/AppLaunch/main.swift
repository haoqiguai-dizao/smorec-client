import AppKit
import Foundation

// LaunchServices starts the application as its own responsible process. A direct
// exec from the updater would inherit the identity of the renamed old bundle.
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 3,
      let data = CommandLine.arguments[2].data(using: .utf8),
      let arguments = try? JSONDecoder().decode([String].self, from: data) else {
    fail("Mac 应用启动参数无效")
}
let url = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
guard url.pathExtension == "app", url.path == url.resolvingSymlinksInPath().path,
      let identity = Bundle(url: url)?.bundleIdentifier,
      ["studio.frameflow.desktop", "studio.frameflow.desktop.capture"].contains(identity) else {
    fail("Mac 应用启动身份无效")
}
let configuration = NSWorkspace.OpenConfiguration()
configuration.createsNewApplicationInstance = true
configuration.allowsRunningApplicationSubstitution = false
configuration.addsToRecentItems = false
configuration.arguments = arguments
configuration.activates = identity != "studio.frameflow.desktop.capture"
if identity == "studio.frameflow.desktop.capture" {
    guard arguments.count == 2, arguments[0].hasPrefix("--protocol-socket="), arguments[1].hasPrefix("--parent-pid=") else {
        fail("录制组件通信参数无效")
    }
}
// NSWorkspace merges caller variables with configuration.environment. Omitting
// a key there does not unset it; clear updater-only variables in the caller too.
unsetenv("ELECTRON_RUN_AS_NODE")
unsetenv("ELECTRON_RENDERER_URL")
configuration.environment = ProcessInfo.processInfo.environment.filter {
    $0.key != "ELECTRON_RUN_AS_NODE" && $0.key != "ELECTRON_RENDERER_URL"
}
let host = NSApplication.shared
host.setActivationPolicy(.prohibited)
NSWorkspace.shared.openApplication(at: url, configuration: configuration) { application, error in
    guard error == nil, let application,
          application.bundleURL?.standardizedFileURL.path == url.path,
          application.processIdentifier > 1 else {
        fail("Mac 应用未能从正式目录启动")
    }
    let result: [String: Any] = ["pid": application.processIdentifier, "target": url.path]
    guard let output = try? JSONSerialization.data(withJSONObject: result) else {
        fail("Mac 应用启动回执无效")
    }
    FileHandle.standardOutput.write(output)
    exit(0)
}
Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { _ in fail("Mac 应用启动超时") }
host.run()
