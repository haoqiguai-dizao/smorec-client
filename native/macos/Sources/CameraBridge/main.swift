import Foundation
import CameraCore

func bridgeJSON(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    FileHandle.standardOutput.write(data + Data([10]))
}
func number(_ key: String) throws -> Int {
    let args = CommandLine.arguments
    guard let index = args.firstIndex(of: key), index + 1 < args.count, let number = Int(args[index + 1]) else {
        throw CameraError("直播参数缺少 \(key)")
    }
    return number
}
do {
    switch CommandLine.arguments.dropFirst().first {
    case "status":
        let installed = try CameraHardware.find() != nil
        var status: [String: Any] = ["installed": installed, "compatible": installed, "name": CameraIdentity.name]
        if !installed, let error = installationError() {
            status["installable"] = false
            status["error"] = error
        } else { status["installable"] = true }
        bridgeJSON(status)
    case "install": ExtensionActivation().run(uninstall: false)
    case "uninstall": ExtensionActivation().run(uninstall: true)
    case "stream":
        let format = try CameraFormat.matching(width: number("--width"), height: number("--height"), fps: number("--fps"))
        try CameraWriter(format: format).run()
    default: throw CameraError("使用 status、install、uninstall 或 stream")
    }
} catch {
    bridgeJSON(["event": "error", "error": error.localizedDescription]); exit(1)
}
