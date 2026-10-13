using System.Runtime.InteropServices;

namespace FrameFlow.Capture;

internal static class RawInputWin32
{
    internal const uint InputSink = 0x0100;
    internal const uint Remove = 0x0001;
    internal const uint InputMessage = 0x00ff;
    internal const uint ReadInput = 0x10000003;

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    internal delegate nint WindowCallback(nint window, uint message, nuint wParam, nint lParam);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct WindowClass
    {
        public uint Size, Style;
        public nint Procedure;
        public int ClassExtra, WindowExtra;
        public nint Instance, Icon, Cursor, Background;
        public string? MenuName;
        public string ClassName;
        public nint SmallIcon;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Device
    {
        public ushort UsagePage, Usage;
        public uint Flags;
        public nint Target;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Header
    {
        public uint Type, Size;
        public nuint Device, WParam;
    }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    internal struct Mouse
    {
        [FieldOffset(0)] public ushort Flags;
        [FieldOffset(4)] public uint Buttons;
        [FieldOffset(8)] public uint RawButtons;
        [FieldOffset(12)] public int LastX;
        [FieldOffset(16)] public int LastY;
        [FieldOffset(20)] public uint ExtraInformation;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Input { public Header Header; public Mouse Mouse; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern ushort RegisterClassEx(ref WindowClass windowClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern bool UnregisterClass(string className, nint instance);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern nint CreateWindowEx(uint extendedStyle, string className, string name, uint style,
        int x, int y, int width, int height, nint parent, nint menu, nint instance, nint parameter);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool DestroyWindow(nint window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern nint DefWindowProc(nint window, uint message, nuint wParam, nint lParam);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool RegisterRawInputDevices([In] Device[] devices, uint count, uint size);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint GetRegisteredRawInputDevices([Out] Device[]? devices, ref uint count, uint size);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint GetRawInputData(nint rawInput, uint command, ref Input data, ref uint size, uint headerSize);
    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool GetCursorPos(out Win32.Point point);
    [DllImport("user32.dll")]
    internal static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);
    internal static bool PrimaryDown() => (GetAsyncKeyState(GetSystemMetrics(23) != 0 ? 2 : 1) & 0x8000) != 0;
}
