import Foundation
import Darwin

enum ProtocolSocket {
    static func connectIfRequested() throws {
        let arguments = CommandLine.arguments.dropFirst()
        guard let argument = arguments.first(where: { $0.hasPrefix("--protocol-socket=") }) else { return }
        let endpoint = String(argument.dropFirst("--protocol-socket=".count))
        guard let parent = arguments.first(where: { $0.hasPrefix("--parent-pid=") }),
              let pid = Int32(parent.dropFirst("--parent-pid=".count)), pid > 1,
              kill(pid, 0) == 0, endpoint.hasSuffix("/rpc"),
              URL(fileURLWithPath: endpoint).deletingLastPathComponent().lastPathComponent.hasPrefix("xl-") else {
            throw NSError(domain: "小录采集", code: 1, userInfo: [NSLocalizedDescriptionKey: "录制通信会话无效"])
        }
        var info = stat()
        guard lstat(endpoint, &info) == 0, (info.st_mode & S_IFMT) == S_IFSOCK, info.st_uid == getuid(),
              (info.st_mode & 0o077) == 0 else {
            throw NSError(domain: "小录采集", code: 2, userInfo: [NSLocalizedDescriptionKey: "录制通信路径无效"])
        }
        var address = sockaddr_un(); address.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(endpoint.utf8) + [0]
        guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
            throw NSError(domain: "小录采集", code: 3, userInfo: [NSLocalizedDescriptionKey: "录制通信路径过长"])
        }
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: bytes) }
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw POSIXError(.EIO) }
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard result == 0 else { close(descriptor); throw POSIXError(.ECONNREFUSED) }
        for destination in [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO] {
            guard dup2(descriptor, destination) >= 0 else { close(descriptor); throw POSIXError(.EIO) }
        }
        close(descriptor)
        setenv("FRAMEFLOW_PARENT_PID", String(pid), 1)
    }
}
