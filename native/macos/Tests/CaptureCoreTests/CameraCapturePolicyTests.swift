import XCTest
import CaptureCore

final class CameraCapturePolicyTests: XCTestCase {
    func testOnlyOwnedCameraPreviewIsExcludedFromDemo() {
        XCTAssertTrue(CameraCapturePolicy.excludesPreview(showOwnApp: true, owningPID: 42, parentPID: 42, title: "小录摄像头"))
        XCTAssertFalse(CameraCapturePolicy.excludesPreview(showOwnApp: true, owningPID: 7, parentPID: 42, title: "小录摄像头"))
        XCTAssertFalse(CameraCapturePolicy.excludesPreview(showOwnApp: true, owningPID: 42, parentPID: 42, title: "小录录制控制"))
        XCTAssertFalse(CameraCapturePolicy.excludesPreview(showOwnApp: true, owningPID: 42, parentPID: 42, title: nil))
        XCTAssertFalse(CameraCapturePolicy.excludesPreview(showOwnApp: false, owningPID: 42, parentPID: 42, title: "小录摄像头"))
    }
}
