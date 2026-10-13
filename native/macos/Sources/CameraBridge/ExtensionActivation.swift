import Foundation
import SystemExtensions
import CameraCore

final class ExtensionActivation: NSObject, OSSystemExtensionRequestDelegate {
    private var pending = false
    private var removing = false
    func run(uninstall: Bool) -> Never {
        removing = uninstall
        if let error = installationError() { bridgeJSON(["installed": false, "error": error]); exit(0) }
        let request = uninstall
            ? OSSystemExtensionRequest.deactivationRequest(forExtensionWithIdentifier: CameraIdentity.extensionID, queue: .main)
            : OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: CameraIdentity.extensionID, queue: .main)
        request.delegate = self
        OSSystemExtensionManager.shared.submitRequest(request)
        DispatchQueue.main.asyncAfter(deadline: .now() + 110) { [self] in
            bridgeJSON(["installed": false, "error": pending ? "请在系统设置的摄像头扩展中批准小录，然后重试" : "系统扩展安装超时，请重试"])
            exit(0)
        }
        RunLoop.main.run()
        exit(1)
    }
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) { pending = true }
    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        bridgeJSON(["installed": false, "error": error.localizedDescription]); exit(0)
    }
    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        bridgeJSON(["installed": !removing && result == .completed, "compatible": result == .completed,
            "needsRestart": result == .willCompleteAfterReboot]); exit(0)
    }
    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties,
                 withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        .replace
    }
}
