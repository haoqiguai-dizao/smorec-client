import XCTest
import CoreMedia
import CoreVideo
@testable import CameraCore

final class CameraFrameTests: XCTestCase {
    func testBothOrientationsKeepBGRAPixelsAndHostTiming() throws {
        for format in CameraFormat.all {
            let pixels = try format.pixelBuffer()
            var bytes = Data(repeating: 0, count: format.frameBytes)
            bytes[0] = 13; bytes[1] = 27; bytes[2] = 91; bytes[3] = 255
            let tail = (format.height - 1) * format.width * 4
            bytes[tail] = 180
            try format.copy(bytes, to: pixels)
            CVPixelBufferLockBaseAddress(pixels, .readOnly)
            let pointer = CVPixelBufferGetBaseAddress(pixels)!.assumingMemoryBound(to: UInt8.self)
            XCTAssertEqual(Array(UnsafeBufferPointer(start: pointer, count: 4)), [13, 27, 91, 255])
            XCTAssertEqual(pointer[(format.height - 1) * CVPixelBufferGetBytesPerRow(pixels)], 180)
            CVPixelBufferUnlockBaseAddress(pixels, .readOnly)
            let time = CMTime(value: 123456, timescale: 1000)
            let sample = try format.sample(pixels, at: time)
            XCTAssertEqual(CMSampleBufferGetPresentationTimeStamp(sample), time)
            XCTAssertEqual(CMSampleBufferGetDuration(sample), CMTime(value: 1, timescale: 30))
            XCTAssertThrowsError(try format.copy(Data([0]), to: pixels))
        }
        XCTAssertThrowsError(try CameraFormat.matching(width: 8192, height: 8192, fps: 30))
        XCTAssertThrowsError(try CameraFormat.matching(width: 1920, height: 1080, fps: 60))
    }
    func testSlowConsumerCannotAllocateUnboundedSurfaces() throws {
        let pool = try CameraFramePool(format: CameraFormat.all[0], maximum: 2)
        let retained = [try pool.next(), try pool.next()]
        try withExtendedLifetime(retained) { XCTAssertThrowsError(try pool.next()) }
    }
}
