import Foundation
import Security
import CameraCore

func installationError() -> String? {
    let bundle = Bundle.main.bundleURL
    guard bundle.pathExtension == "app" else { return "请从小录应用内安装虚拟摄像头" }
    guard bundle.deletingLastPathComponent().path == "/Applications" else { return "请先把小录移到“应用程序”文件夹，再安装虚拟摄像头" }
    var own: SecCode?, code: SecStaticCode?, information: CFDictionary?
    guard SecCodeCopySelf([], &own) == errSecSuccess, let own,
          SecCodeCopyStaticCode(own, [], &code) == errSecSuccess, let code,
          SecCodeCopySigningInformation(code, [], &information) == errSecSuccess,
          let team = (information as? [String: Any])?[kSecCodeInfoTeamIdentifier as String] as? String, !team.isEmpty else {
        return "此版本缺少 Apple 开发者签名，暂不能启用 Mac 虚拟摄像头"
    }
    let extensionURL = bundle.appendingPathComponent("Contents/Library/SystemExtensions/\(CameraIdentity.extensionID).systemextension")
    guard FileManager.default.fileExists(atPath: extensionURL.path) else { return "应用内缺少虚拟摄像头扩展，请重新安装小录" }
    return nil
}
