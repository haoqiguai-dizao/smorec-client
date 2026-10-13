import Foundation
import ApplicationServices

/// 后台采集进程不依赖 NSApplication 的窗口事件循环。只监听类型、位置和修饰键；不读取键码或文字。
final class InputEventMonitor: @unchecked Sendable {
    private let lock = NSLock()
    private let callback: (CGPoint, Bool, Bool) -> Void
    private var runLoop: CFRunLoop?
    private var tap: CFMachPort?
    private var stopped = false
    init(callback: @escaping (CGPoint, Bool, Bool) -> Void) { self.callback = callback }
    func start() -> Bool {
        let events: [CGEventType] = [.leftMouseDown, .rightMouseDown, .otherMouseDown, .keyDown]
        let mask = events.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
            eventsOfInterest: mask, callback: { _, type, event, pointer in
                guard let pointer else { return Unmanaged.passUnretained(event) }
                let monitor = Unmanaged<InputEventMonitor>.fromOpaque(pointer).takeUnretainedValue()
                if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                    monitor.enable()
                } else {
                    let typing = type == .keyDown
                    let shortcut = !event.flags.intersection([.maskCommand, .maskControl, .maskSecondaryFn]).isEmpty
                    monitor.callback(event.location, typing, shortcut)
                }
                return Unmanaged.passUnretained(event)
            }, userInfo: Unmanaged.passUnretained(self).toOpaque()),
            let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else { return false }
        self.tap = tap
        // 线程闭包持有 monitor，直到源失效并离开循环，避免回调与销毁竞争。
        let thread = Thread { [self] in
            let loop = CFRunLoopGetCurrent()!
            lock.lock(); runLoop = loop; let active = !stopped; lock.unlock()
            CFRunLoopAddSource(loop, source, .defaultMode)
            if active { CFRunLoopRun() }
            CFRunLoopRemoveSource(loop, source, .defaultMode)
            CFMachPortInvalidate(tap)
            lock.lock(); runLoop = nil; self.tap = nil; lock.unlock()
        }
        thread.name = "小录输入活动"; thread.qualityOfService = .userInitiated; thread.start()
        return true
    }
    private func enable() {
        lock.lock(); defer { lock.unlock() }
        if !stopped, let tap { CGEvent.tapEnable(tap: tap, enable: true) }
    }
    func stop() {
        lock.lock()
        stopped = true
        let loop = runLoop
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        lock.unlock()
        if let loop {
            CFRunLoopPerformBlock(loop, CFRunLoopMode.defaultMode.rawValue) { CFRunLoopStop(loop) }
            CFRunLoopWakeUp(loop)
        }
    }
}
