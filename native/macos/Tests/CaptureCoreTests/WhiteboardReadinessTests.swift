import XCTest
@testable import CaptureCore

final class WhiteboardReadinessTests: XCTestCase {
    func testAlreadyAvailableWindowDoesNotWait() async throws {
        let value = try await WhiteboardReadiness.wait(pause: { XCTFail("Unexpected retry") }) { 42 }
        XCTAssertEqual(value, 42)
    }

    func testDelayedWindowIsReadAgainBeforeIncludingIt() async throws {
        var reads = 0, pauses = 0
        let value: Int = try await WhiteboardReadiness.wait(pause: { pauses += 1 }) {
            reads += 1
            return reads == 3 ? 42 : nil
        }
        XCTAssertEqual(value, 42)
        XCTAssertEqual(reads, 3)
        XCTAssertEqual(pauses, 2)
    }

    func testMissingWindowHasABoundedRetryBudget() async {
        var reads = 0, pauses = 0
        do {
            let _: Int = try await WhiteboardReadiness.wait(attempts: 3, pause: { pauses += 1 }) {
                reads += 1
                return nil
            }
            XCTFail("A missing window must fail")
        } catch { XCTAssertTrue(error.localizedDescription.contains("白板窗口尚未就绪")) }
        XCTAssertEqual(reads, 3)
        XCTAssertEqual(pauses, 2)
    }

    func testPermissionErrorsAreNotRetried() async {
        var reads = 0
        do {
            let _: Int = try await WhiteboardReadiness.wait(pause: { XCTFail("Unexpected retry") }) {
                reads += 1
                throw CaptureFailure("录屏权限被拒绝")
            }
            XCTFail("Permission failure must propagate")
        } catch { XCTAssertTrue(error.localizedDescription.contains("录屏权限被拒绝")) }
        XCTAssertEqual(reads, 1)
    }
}
