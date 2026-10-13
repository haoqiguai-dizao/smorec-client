Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;
public sealed class OwnedLivePreviewWindow : IDisposable {
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr Window; public uint Id; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Point; public uint Private; }
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] private static extern IntPtr CreateWindowEx(uint ex, string cls, string text, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] private static extern bool UpdateWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool PeekMessage(out Message message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref Message message);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    private readonly ManualResetEventSlim ready = new ManualResetEventSlim();
    private readonly Thread thread;
    private volatile bool stopped;
    private Exception error;
    public IntPtr Handle { get; private set; }
    public OwnedLivePreviewWindow() {
        thread = new Thread(Run) { IsBackground=true, Name="Owned live preview fixture" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
        if (!ready.Wait(3000)) throw new TimeoutException("Owned fixture window did not initialize.");
        if (error != null) throw error;
    }
    private void Run() {
        try {
            SetThreadDpiAwarenessContext(new IntPtr(-4));
            // WS_EX_NOACTIVATE keeps the user's current foreground window unchanged.
            Handle = CreateWindowEx(0x08000000, "STATIC", "SYNTHETIC LIVE PREVIEW FIXTURE", 0x10cf0000,
                120, 120, 360, 240, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (Handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            Console.Error.WriteLine("Owned fixture visible after creation: " + IsWindowVisible(Handle));
            // Node windowsHide applies STARTUPINFO's hidden show state to initial windows.
            // Explicitly show only this fixture without activating it after creation.
            ShowWindow(Handle, 4); UpdateWindow(Handle);
            Console.Error.WriteLine("Owned fixture visible after show: " + IsWindowVisible(Handle));
            ready.Set();
            while (!stopped) {
                Message message;
                while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessage(ref message); }
                Thread.Sleep(5);
            }
        } catch (Exception ex) { error=ex; ready.Set(); }
        finally { if (Handle != IntPtr.Zero) DestroyWindow(Handle); }
    }
    public void Dispose() { stopped=true; thread.Join(2000); ready.Dispose(); }
}
"@
