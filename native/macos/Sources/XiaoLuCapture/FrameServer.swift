import Foundation
import Darwin
import AVFoundation
import CaptureCore

/// One same-user consumer, one latest BGRA frame; no queued frames or network listener.
final class FrameServer: @unchecked Sendable {
    private let lock = NSLock()
    private var latest: Data?
    private var origin: CMTime?
    private var listener: Int32 = -1
    private var client: Int32 = -1
    private var stopped = false
    private var ownsAddress = false
    private let address: String
    private let width: Int
    private let height: Int
    private let audio: LiveAudio?

    init(name: String, width: Int, height: Int, audio: LiveAudio? = nil) throws {
        guard name.range(of: "^xiaolu-live-[a-fA-F0-9-]{36}$", options: .regularExpression) != nil else { throw CaptureFailure("直播通道标识无效") }
        self.width = width; self.height = height; self.audio = audio
        let root = "/tmp/smorec-\(getuid())"
        if mkdir(root, 0o700) != 0 && errno != EEXIST { throw CaptureFailure("无法创建直播通道目录") }
        var info = stat()
        guard lstat(root, &info) == 0, info.st_uid == getuid(), info.st_mode & S_IFMT == S_IFDIR,
              info.st_mode & 0o077 == 0 else { throw CaptureFailure("直播通道目录权限无效") }
        address = root + "/" + name + ".sock"
        var socketAddress = sockaddr_un()
        socketAddress.sun_family = sa_family_t(AF_UNIX)
        socketAddress.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        let pathBytes = Array(address.utf8) + [0]
        guard pathBytes.count <= MemoryLayout.size(ofValue: socketAddress.sun_path) else { throw CaptureFailure("直播通道路径过长") }
        withUnsafeMutableBytes(of: &socketAddress.sun_path) { destination in destination.copyBytes(from: pathBytes) }
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { throw CaptureFailure("无法创建本地直播通道") }
        var suppressPipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &suppressPipe, socklen_t(MemoryLayout<Int32>.size))
        let bound = withUnsafePointer(to: &socketAddress) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard bound == 0 else { close(fd); throw CaptureFailure("直播通道已存在或不能绑定") }
        ownsAddress = true
        guard chmod(address, 0o600) == 0, listen(fd, 1) == 0 else { close(fd); unlink(address); throw CaptureFailure("无法监听本地直播通道") }
        listener = fd
        DispatchQueue.global(qos: .userInitiated).async { self.serve(fd) }
    }

    func publish(_ pixel: CVPixelBuffer, origin: CMTime) {
        guard CVPixelBufferGetWidth(pixel) == width, CVPixelBufferGetHeight(pixel) == height else { return }
        CVPixelBufferLockBaseAddress(pixel, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixel, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixel) else { return }
        let stride = CVPixelBufferGetBytesPerRow(pixel)
        var data = Data(capacity: width * height * 4)
        for row in 0..<height { data.append(base.advanced(by: row * stride).assumingMemoryBound(to: UInt8.self), count: width * 4) }
        lock.lock(); latest = data; self.origin = origin; lock.unlock()
    }

    func clear() {
        lock.lock(); latest = Data(count: width * height * 4); lock.unlock()
    }

    private func serve(_ fd: Int32) {
        let connection = accept(fd, nil, nil)
        guard connection >= 0 else { return }
        var uid: uid_t = 0, gid: gid_t = 0
        guard getpeereid(connection, &uid, &gid) == 0, uid == getuid() else { close(connection); return }
        lock.lock()
        if stopped { lock.unlock(); close(connection); return }
        client = connection; lock.unlock()
        var timeout = timeval(tv_sec: 5, tv_usec: 0), suppressPipe: Int32 = 1
        setsockopt(connection, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &suppressPipe, socklen_t(MemoryLayout<Int32>.size))
        defer {
            lock.lock(); client = -1; lock.unlock()
            close(connection)
        }
        var request: UInt8 = 0
        while read(connection, &request, 1) == 1 && request == 1 {
            lock.lock(); let frame = latest, clock = origin, ended = stopped; lock.unlock()
            guard !ended, let frame, let clock else { return }
            var header = Data()
            func word(_ value: UInt32) { var le = value.littleEndian; withUnsafeBytes(of: &le) { header.append(contentsOf: $0) } }
            word(0x584c4652); word(UInt32(width)); word(UInt32(height)); word(UInt32(frame.count))
            var time = max(0, CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), clock).seconds)
            withUnsafeBytes(of: &time) { header.append(contentsOf: $0) }
            guard send(header, fd: connection), send(frame, fd: connection) else { return }
            if let audio {
                let packet = audio.pull(now: time)
                var audioHeader = Data()
                func word(_ value: UInt32) { var le = value.littleEndian; withUnsafeBytes(of: &le) { audioHeader.append(contentsOf: $0) } }
                word(0x584c4155); word(UInt32(packet.data.count))
                var timestamp = packet.time.bitPattern.littleEndian
                withUnsafeBytes(of: &timestamp) { audioHeader.append(contentsOf: $0) }
                guard send(audioHeader, fd: connection), packet.data.isEmpty || send(packet.data, fd: connection) else { return }
            }
        }
    }

    private func send(_ data: Data, fd: Int32) -> Bool {
        data.withUnsafeBytes { bytes in
            guard let base = bytes.baseAddress else { return false }
            var sent = 0
            while sent < bytes.count {
                let count = Darwin.write(fd, base.advanced(by: sent), bytes.count - sent)
                if count < 0 && errno == EINTR { continue }
                guard count > 0 else { return false }
                sent += count
            }
            return true
        }
    }

    func stop() {
        lock.lock()
        if stopped { lock.unlock(); return }
        stopped = true
        let fd = listener, connection = client
        listener = -1; latest = nil; lock.unlock()
        if connection >= 0 { shutdown(connection, SHUT_RDWR) }
        if fd >= 0 { shutdown(fd, SHUT_RDWR); close(fd) }
        if ownsAddress { unlink(address) }
    }
    deinit { stop() }
}
