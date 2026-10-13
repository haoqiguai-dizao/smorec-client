import XCTest
import AVFoundation
import Darwin
@testable import XiaoLuCapture

final class FrameServerTests: XCTestCase {
    func connect(_ path: String) throws -> Int32 {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
        withUnsafeMutableBytes(of: &address.sun_path) { $0.copyBytes(from: Array(path.utf8) + [0]) }
        let result = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        guard result == 0 else { close(fd); throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        return fd
    }

    func pull(_ fd: Int32, bytes: Int) throws -> Data {
        var request: UInt8 = 1
        XCTAssertEqual(write(fd, &request, 1), 1)
        var data = Data(count: bytes)
        try data.withUnsafeMutableBytes { buffer in
            var offset = 0
            while offset < bytes {
                let count = read(fd, buffer.baseAddress!.advanced(by: offset), bytes - offset)
                guard count > 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
                offset += count
            }
        }
        return data
    }

    func testProtocolPixelsFilterClearAndSocketCleanup() throws {
        let name = "xiaolu-live-\(UUID().uuidString)"
        let address = "/tmp/smorec-\(getuid())/\(name).sock"
        let server = try FrameServer(name: name, width: 32, height: 32)
        defer { server.stop() }
        XCTAssertThrowsError(try FrameServer(name: name, width: 32, height: 32))
        var info = stat()
        XCTAssertEqual(lstat(address, &info), 0)
        XCTAssertEqual(info.st_mode & 0o777, 0o600)
        var pixel: CVPixelBuffer?
        XCTAssertEqual(CVPixelBufferCreate(nil, 32, 32, kCVPixelFormatType_32BGRA, nil, &pixel), kCVReturnSuccess)
        CVPixelBufferLockBaseAddress(pixel!, [])
        memset(CVPixelBufferGetBaseAddress(pixel!), 97, CVPixelBufferGetDataSize(pixel!))
        CVPixelBufferUnlockBaseAddress(pixel!, [])
        server.publish(pixel!, origin: CMClockGetTime(CMClockGetHostTimeClock()))
        let fd = try connect(address)
        defer { close(fd) }
        let frame = try pull(fd, bytes: 24 + 32 * 32 * 4)
        XCTAssertEqual(Array(frame.prefix(4)), [0x52, 0x46, 0x4c, 0x58])
        XCTAssertEqual(frame.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self) }, 32)
        XCTAssertGreaterThanOrEqual(frame.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 16, as: Double.self) }, 0)
        XCTAssertTrue(frame.dropFirst(24).allSatisfy { $0 == 97 })
        server.clear()
        let cleared = try pull(fd, bytes: frame.count)
        XCTAssertTrue(cleared.dropFirst(24).allSatisfy { $0 == 0 })
        server.stop(); server.stop()
        XCTAssertFalse(FileManager.default.fileExists(atPath: address))
    }
}
