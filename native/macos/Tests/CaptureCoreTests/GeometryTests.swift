import XCTest
@testable import CaptureCore

final class GeometryTests: XCTestCase {
    func options(_ extra: String = "") throws -> CaptureOptions {
        try JSONDecoder().decode(CaptureOptions.self, from: Data("{\"sourceId\":\"screen:1\",\"systemAudio\":true,\"microphone\":false,\"fps\":30\(extra)}".utf8))
    }
    func testPresetsNeverUpscaleAndKeepEvenPhysicalDimensions() throws {
        let option = try options(",\"resolution\":\"2160p\"")
        let small = try option.dimensions(sourceWidth: 1365, sourceHeight: 767)
        XCTAssertEqual(small.0, 1364); XCTAssertEqual(small.1, 766)
        let retina = try option.dimensions(sourceWidth: 5120, sourceHeight: 2880)
        XCTAssertEqual(retina.0, 3840); XCTAssertEqual(retina.1, 2160)
    }
    func testCropUsesPhysicalPixelsAndRejectsOverflow() throws {
        let valid = try options(",\"crop\":{\"x\":100,\"y\":50,\"width\":800,\"height\":600}")
        XCTAssertEqual(try valid.dimensions(sourceWidth: 1920, sourceHeight: 1080).0, 800)
        XCTAssertThrowsError(try valid.dimensions(sourceWidth: 800, sourceHeight: 600))
    }
    func testRetinaNegativeMonitorAndCropCoordinates() {
        let bounds = CaptureRect(x: -1920, y: -200, width: 1920, height: 1080)
        let crop = CaptureRect(x: 200, y: 100, width: 1600, height: 1200)
        let point = normalizedPoint(x: -1420, y: 150, bounds: bounds, crop: crop, scale: 2)
        XCTAssertEqual(point.0, 0.5); XCTAssertEqual(point.1, 0.5); XCTAssertTrue(point.2)
        XCTAssertFalse(normalizedPoint(x: 1, y: 1, bounds: bounds, crop: crop, scale: 2).2)
    }
    func testApplicationIdentityRejectsPathsAndDeduplicates() throws {
        XCTAssertEqual(try validatedApplicationIDs(["com.example.App", "com.example.App"]), ["com.example.App"])
        for bad in ["/Applications/App.app", "../example", "com.app\n", ""] {
            XCTAssertThrowsError(try validatedApplicationIDs([bad]))
        }
    }
    func testCompleteActivityCaptureCannotSilentlyStartWithMissingAccess() throws {
        XCTAssertNil(try options().inputRecording, "Legacy recordings keep complete activity capture")
        XCTAssertFalse(try options(",\"inputRecording\":false").inputRecording!)
        XCTAssertNoThrow(try requireInputRecordingAccess(enabled: false, inputAllowed: false, accessibilityAllowed: false))
        XCTAssertNoThrow(try requireInputRecordingAccess(enabled: true, inputAllowed: true, accessibilityAllowed: true))
        for (input, accessibility, missing) in [(false, true, "输入监控"), (true, false, "辅助功能"), (false, false, "输入监控、辅助功能")] {
            XCTAssertThrowsError(try requireInputRecordingAccess(enabled: true, inputAllowed: input, accessibilityAllowed: accessibility)) {
                XCTAssertTrue($0.localizedDescription.contains(missing))
                XCTAssertTrue($0.localizedDescription.contains("仅录画面与声音"))
            }
        }
    }
}
