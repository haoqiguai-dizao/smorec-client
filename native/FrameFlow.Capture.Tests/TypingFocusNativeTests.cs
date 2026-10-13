using System.Diagnostics;
using System.Runtime.InteropServices;
using FrameFlow.Capture;

// Opt-in integration check: owns both Edit controls, writes only fixed synthetic text,
// never injects global input and restores foreground only if the test still owns it.
internal static class TypingFocusNativeTests
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint CreateWindowEx(uint extended, string className, string title, uint style,
        int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(nint window);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint window);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern nint SetFocus(nint window);
    [DllImport("user32.dll")] private static extern nint SendMessage(nint window, uint message, nint wparam, nint lparam);

    internal static void Run(Action<bool, string> check)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
        Win32.SetProcessDpiAwarenessContext((nint)(-4));
        var previous = GetForegroundWindow();
        var window = CreateWindowEx(0, "STATIC", "小录 · 受控输入焦点验收", 0x10cf0000,
            120, 120, 640, 360, 0, 0, Win32.GetModuleHandle(null), 0);
        check(window != 0, "controlled focus fixture owns a native test window");
        try
        {
            var first = CreateWindowEx(0x200, "EDIT", "SYNTHETIC FOCUS A", 0x50010080,
                30, 35, 230, 32, window, 0, 0, 0);
            var second = CreateWindowEx(0x200, "EDIT", "SYNTHETIC FOCUS B", 0x50010080,
                330, 220, 230, 32, window, 0, 0, 0);
            check(first != 0 && second != 0, "both native Edit controls belong exclusively to the fixture");
            SetForegroundWindow(window);
            SetFocus(first);
            SendMessage(first, 0xb1, 0, 0); // EM_SETSEL: insertion at the start of fixed fixture text.
            PumpUntil(() => TypingFocusWin32.Read().Focus == first, window, 1000);
            var firstFocus = TypingFocusWin32.Read();
            check(firstFocus == new InputFocus(window, first), "the first synthetic editor has verified foreground and native focus");
            var firstCaret = TypingFocusWin32.Caret(firstFocus);
            check(firstCaret is not null, "Win32 caret location is available for the owned native Edit control");
            Win32.GetWindowRect(first, out var firstBounds);
            check(Inside(firstCaret!.Value, firstBounds), "DPI-mapped caret lies inside its physical editor rectangle");
            var automation = Task.Run(() => OperatingSystem.IsWindows() ? TypingFocusAutomation.ReadEditorBounds(firstFocus) : null);
            PumpUntil(() => automation.IsCompleted, window, 3000);
            var rect = automation.GetAwaiter().GetResult();
            check(rect is not null && Math.Abs(rect[0] - firstBounds.Left) <= 3
                && Math.Abs(rect[1] - firstBounds.Top) <= 3,
                "UI Automation vtable and geometric property reads resolve the owned editor without reading content");
            var clock = new CaptureClock();
            using var locator = new TypingFocusLocator(clock, () => Win32.WindowBounds(window), null, window, new HashSet<nint>());
            var position = locator.Read(clock.Seconds, firstFocus);
            check(position is not null && TypingFocusGeometry.Valid(position), "the shared locator produces normalized source coordinates");
            var activity = new List<InputActivitySample>();
            var state = new TypingActivityState(activity.Add);
            state.Key(clock.Seconds, TypingKeyAction.Typing, firstFocus, position);
            check(activity.Any(sample => sample.Kind == "typing" && sample.Focus == position),
                "a classified synthetic typing event starts focus without any mouse click");
            state.Key(clock.Seconds, TypingKeyAction.Reset, firstFocus);
            locator.Invalidate();
            SetFocus(second);
            SendMessage(second, 0xb1, 0, 0);
            PumpUntil(() => TypingFocusWin32.Read().Focus == second, window, 1000);
            var secondFocus = TypingFocusWin32.Read();
            var secondPosition = locator.Read(clock.Seconds, secondFocus);
            check(secondPosition is not null && secondPosition.X > position!.X + .25 && secondPosition.Y > position.Y + .3,
                "programmatic focus transfer identifies the second editor without moving or clicking the pointer");
            state.Key(clock.Seconds, TypingKeyAction.Typing, secondFocus, secondPosition);
            check(activity[^1].Focus == secondPosition, "input resumes at the newly focused synthetic editor after a Tab-like reset");
            using var excluded = new TypingFocusLocator(clock, () => Win32.WindowBounds(window), null,
                window, new HashSet<nint> { window });
            check(excluded.Read(clock.Seconds, secondFocus) is null, "excluded application windows cannot establish input focus");
        }
        finally
        {
            var restore = GetForegroundWindow() == window;
            DestroyWindow(window);
            if (restore && previous != 0) SetForegroundWindow(previous);
        }
    }

    private static bool Inside(Win32.Point point, Win32.Rect rect) => point.X >= rect.Left && point.X <= rect.Right
        && point.Y >= rect.Top && point.Y <= rect.Bottom;

    private static void PumpUntil(Func<bool> complete, nint ownedWindow, int timeoutMs)
    {
        var timer = Stopwatch.StartNew();
        while (!complete())
        {
            if (GetForegroundWindow() != ownedWindow) throw new InvalidOperationException("Fixture lost foreground; stopped without inspecting another window.");
            if (timer.ElapsedMilliseconds > timeoutMs) throw new TimeoutException("Owned focus fixture did not become ready within its bounded wait.");
            while (Win32.PeekMessage(out var message, 0, 0, 0, 1))
            {
                Win32.TranslateMessage(ref message);
                Win32.DispatchMessage(ref message);
            }
            Thread.Sleep(5);
        }
        if (GetForegroundWindow() != ownedWindow) throw new InvalidOperationException("Fixture lost foreground; verification aborted.");
    }
}
