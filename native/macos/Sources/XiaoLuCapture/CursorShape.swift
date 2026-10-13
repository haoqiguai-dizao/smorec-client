import AppKit

/// Only the three portable cursor shapes are saved, never cursor images from another app.
enum CursorShape {
    private static let hand = NSCursor.pointingHand.image.tiffRepresentation
    private static let text = NSCursor.iBeam.image.tiffRepresentation

    static func current() -> String {
        // Public compatibility API: unlike current, this observes the cursor outside this process.
        // ScreenCaptureKit offers baked-in cursors but no separate cursor-shape stream.
        guard let image = NSCursor.currentSystem?.image.tiffRepresentation else { return "arrow" }
        if image == text { return "ibeam" }
        if image == hand { return "hand" }
        return "arrow"
    }
}
