using System.Runtime.InteropServices;
using FrameFlow.Capture;

// A visible owned window with WS_EX_NOACTIVATE; no foreground change or input injection.
internal static class RecordingExclusionInputTests
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern nint CreateWindowEx(uint extended, string cls, string text, uint style,
        int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(nint window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(nint window, int command);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(nint window);
    internal static void Run(Action<bool, string> check)
    {
        Win32.SetProcessDpiAwarenessContext((nint)(-4));
        var instance = Win32.GetModuleHandle(null); var className = "OwnedExclusionInput-" + Guid.NewGuid();
        RawInputWin32.WindowCallback callback = RawInputWin32.DefWindowProc;
        var cls = new RawInputWin32.WindowClass { Size = (uint)Marshal.SizeOf<RawInputWin32.WindowClass>(),
            Procedure = Marshal.GetFunctionPointerForDelegate(callback), Instance = instance, ClassName = className, Background = (nint)6 };
        check(RawInputWin32.RegisterClassEx(ref cls) != 0, "owned fixture uses a normal hit-testable window class");
        var window = CreateWindowEx(0x08000008, className, "PUBLIC EXCLUSION INPUT FIXTURE", 0x90000000,
            180, 180, 320, 240, 0, 0, instance, 0);
        check(window != 0, "input exclusion test owns a non-activating window");
        try
        {
            ShowWindow(window, 4); UpdateWindow(window);
            var child = CreateWindowEx(0, "STATIC", "PUBLIC CONTROL", 0x50000006, 30, 30, 100, 50, window, 0, 0, 0);
            check(child != 0, "the test point belongs to an owned child control");
            Win32.GetWindowRect(child, out var rect);
            while (Win32.PeekMessage(out var message, 0, 0, 0, 1)) { Win32.TranslateMessage(ref message); Win32.DispatchMessage(ref message); }
            var point = new Win32.Point { X = (rect.Left + rect.Right) / 2, Y = (rect.Top + rect.Bottom) / 2 };
            check(TypingFocusWin32.IsExcludedAtPoint(point, new HashSet<nint> { window }),
                "cursor filtering recognizes an excluded root through its child control without requiring keyboard focus");
            check(!TypingFocusWin32.IsExcludedAtPoint(point, new HashSet<nint>()),
                "cursor filtering releases the same point when the selection is cleared");
            var clock = new CaptureClock(); var boundsReads = 0;
            using var locator = new TypingFocusLocator(clock, () => { boundsReads++; return Win32.WindowBounds(window); }, null, 0, new HashSet<nint>());
            var focus = new InputFocus(window, child);
            locator.Read(clock.Seconds, focus);
            check(boundsReads == 1, "unexcluded owned focus reaches source geometry validation");
            locator.SetExcludedWindows(new HashSet<nint> { window });
            check(locator.Read(clock.Seconds, focus) is null && boundsReads == 1,
                "a dynamic exclusion blocks previously allowed focus before geometry or accessibility lookup");
            locator.SetExcludedWindows(new HashSet<nint>());
            locator.Read(clock.Seconds, focus);
            check(boundsReads == 2, "clearing exclusions restores geometry validation using the same locator");
        }
        finally { DestroyWindow(window); RawInputWin32.UnregisterClass(className, instance); GC.KeepAlive(callback); }
    }
}
