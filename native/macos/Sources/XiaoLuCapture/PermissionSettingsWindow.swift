import AppKit

enum PermissionSettingsWindow {
    // Fixed Settings identity, metadata only. Does not request capture or Accessibility.
    static func bounds() -> [String: Any] {
        let pids = Set(NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.systempreferences")
            .map { $0.processIdentifier })
        guard !pids.isEmpty,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return [:] }
        let candidates = windows.compactMap { item -> CGRect? in
            guard let pid = item[kCGWindowOwnerPID as String] as? Int32, pids.contains(pid),
                  item[kCGWindowLayer as String] as? Int == 0,
                  let raw = item[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: raw), rect.width > 200, rect.height > 200 else { return nil }
            return rect
        }
        guard let rect = candidates.max(by: { $0.width * $0.height < $1.width * $1.height }) else { return [:] }
        let front = NSWorkspace.shared.frontmostApplication
        let foreground = front?.bundleIdentifier == "com.apple.systempreferences"
            || front?.processIdentifier == SourceCatalog.parentPID
        return ["bounds": ["x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height],
                "foreground": foreground]
    }
}
