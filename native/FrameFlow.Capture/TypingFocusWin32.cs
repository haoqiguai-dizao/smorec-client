using System.Runtime.InteropServices;

namespace FrameFlow.Capture;

internal static class TypingFocusWin32
{
    [StructLayout(LayoutKind.Sequential)]
    private struct GuiThreadInfo
    {
        public uint Size, Flags;
        public nint Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public Win32.Rect CaretRect;
    }

    [DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetGUIThreadInfo(uint thread, ref GuiThreadInfo info);
    [DllImport("user32.dll")]
    private static extern nint WindowFromPoint(Win32.Point point);
    [DllImport("user32.dll")]
    private static extern nint GetAncestor(nint window, uint flags);
    [DllImport("user32.dll")]
    private static extern bool IsChild(nint parent, nint child);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern nuint SetTimer(nint window, nuint id, uint milliseconds, nint callback);
    [DllImport("user32.dll")]
    internal static extern bool KillTimer(nint window, nuint id);

    [DllImport("user32.dll")]
    private static extern bool ClientToScreen(nint window, ref Win32.Point point);
    [DllImport("user32.dll")]
    private static extern bool LogicalToPhysicalPointForPerMonitorDPI(nint window, ref Win32.Point point);
    [DllImport("user32.dll")]
    private static extern nint GetWindowDpiAwarenessContext(nint window);
    [DllImport("user32.dll")]
    private static extern nint SetThreadDpiAwarenessContext(nint context);

    internal static InputFocus Read()
    {
        var foreground = GetForegroundWindow();
        if (foreground == 0) return default;
        var thread = Win32.GetWindowThreadProcessId(foreground, out _);
        var info = new GuiThreadInfo { Size = (uint)Marshal.SizeOf<GuiThreadInfo>() };
        if (thread == 0 || !GetGUIThreadInfo(thread, ref info) || info.Focus == 0
            || !FocusModePermitsAnchor(info.Flags) || GetForegroundWindow() != foreground) return default;
        if (GetAncestor(info.Focus, 2) != foreground) return default;
        return new InputFocus(foreground, info.Focus);
    }

    internal static InputFocus AtClick(Win32.Point point, bool inRecording, nint sourceWindow,
        IReadOnlySet<nint> excluded)
    {
        if (!inRecording) return default;
        var current = Read();
        if (!Permitted(current, sourceWindow, excluded)) return default;
        var hit = WindowFromPoint(point);
        if (hit == 0 || GetAncestor(hit, 2) != current.Foreground) return default;
        // A click in a sibling control is not evidence of the previously focused editor.
        return hit == current.Focus || IsChild(current.Focus, hit) ? current : default;
    }
    internal static bool IsExcludedAtPoint(Win32.Point point, IReadOnlySet<nint> excluded)
    {
        var hit = WindowFromPoint(point);
        return hit != 0 && (excluded.Contains(hit) || excluded.Contains(GetAncestor(hit, 2)));
    }

    internal static bool Permitted(InputFocus current, nint sourceWindow, IReadOnlySet<nint> excluded) =>
        current.Valid && !excluded.Contains(current.Foreground) && !excluded.Contains(current.Focus)
        && (sourceWindow == 0 || current.Foreground == GetAncestor(sourceWindow, 2));

    internal static bool PointBelongsTo(Win32.Point point, InputFocus current)
    {
        var hit = WindowFromPoint(point);
        return hit != 0 && GetAncestor(hit, 2) == current.Foreground;
    }

    internal static Win32.Point? Caret(InputFocus current)
    {
        if (!current.Valid) return null;
        var thread = Win32.GetWindowThreadProcessId(current.Foreground, out _);
        var info = new GuiThreadInfo { Size = (uint)Marshal.SizeOf<GuiThreadInfo>() };
        if (thread == 0 || !GetGUIThreadInfo(thread, ref info) || info.Caret == 0 || info.Focus != current.Focus
            || !FocusModePermitsAnchor(info.Flags) || GetForegroundWindow() != current.Foreground
            || (info.Caret != current.Focus && !IsChild(current.Focus, info.Caret))
            || info.CaretRect.Height is <= 0 or > 256 || info.CaretRect.Width is < 0 or > 80) return null;
        var point = new Win32.Point { X = info.CaretRect.Left + info.CaretRect.Width / 2,
            Y = info.CaretRect.Top + info.CaretRect.Height / 2 };
        // GUITHREADINFO uses the target's logical coordinates. Map in that DPI context,
        // then explicitly convert to physical pixels like the screen-capture bounds.
        var previous = SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(info.Caret));
        if (previous == 0) return null;
        try
        {
            if (!ClientToScreen(info.Caret, ref point)
                || !LogicalToPhysicalPointForPerMonitorDPI(info.Caret, ref point)) return null;
        }
        finally { SetThreadDpiAwarenessContext(previous); }
        return Read() == current && PointBelongsTo(point, current) ? point : null;
    }

    internal static bool ShortcutHeld() => Down(17) || Down(18) || Down(91) || Down(92);
    internal static bool FocusModePermitsAnchor(uint flags) => (flags & 0x001e) == 0;
    private static bool Down(int key) => (RawInputWin32.GetAsyncKeyState(key) & 0x8000) != 0;
}
