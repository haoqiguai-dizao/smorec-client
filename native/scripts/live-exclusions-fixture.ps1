param([switch]$Foreground, [switch]$GrayBackground, [ValidateRange(1, 128)][int]$VisibleWindows = 1, [ValidateRange(0, 128)][int]$HiddenWindows = 0)
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Collections.Generic;
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
    private readonly ManualResetEventSlim revealed = new ManualResetEventSlim();
    private readonly List<IntPtr> windows = new List<IntPtr>();
    private readonly Thread thread;
    private readonly int visibleCount, hiddenCount;
    private volatile bool revealRequested;
    private volatile bool stopped;
    private readonly bool white;
    private readonly bool gray;
    private Exception error;
    public IntPtr Handle { get; private set; }
    public int WindowCount { get { return windows.Count; } }
    public OwnedLivePreviewWindow(bool white, int visibleCount, int hiddenCount, bool gray) {
        this.white = white; this.visibleCount = visibleCount; this.hiddenCount = hiddenCount; this.gray = gray;
        thread = new Thread(Run) { IsBackground=true, Name="Owned live preview fixture" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start();
        if (!ready.Wait(3000)) throw new TimeoutException("Owned fixture window did not initialize.");
        if (error != null) throw error;
    }
    private void Run() {
        try {
            SetThreadDpiAwarenessContext(new IntPtr(-4));
            // WS_EX_NOACTIVATE keeps the user's current foreground window unchanged.
            Handle = CreateWindowEx(0x08000008, "STATIC", "SYNTHETIC EXCLUSION FIXTURE", white ? 0x90000006u : gray ? 0x90000005u : 0x90000004u,
                white ? 180 : 120, white ? 180 : 120, white ? 320 : 640, white ? 240 : 480, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (Handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            Console.Error.WriteLine("Owned fixture visible after creation: " + IsWindowVisible(Handle));
            // Node windowsHide applies STARTUPINFO's hidden show state to initial windows.
            // Explicitly show only this fixture without activating it after creation.
            ShowWindow(Handle, 4); UpdateWindow(Handle);
            Console.Error.WriteLine("Owned fixture visible after show: " + IsWindowVisible(Handle));
            windows.Add(Handle);
            for (int index = 1; index < visibleCount + hiddenCount; index++) {
                var window = CreateWindowEx(0x08000008, "STATIC", "SYNTHETIC EXCLUSION FIXTURE EXTRA", 0x80000006u,
                    220 + (index % 8) * 8, 220 + ((index / 8) % 8) * 8, 8, 8, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
                if (window == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
                windows.Add(window);
                if (index < visibleCount) { ShowWindow(window, 4); UpdateWindow(window); }
            }
            ready.Set();
            while (!stopped) {
                if (revealRequested) {
                    for (int index = visibleCount; index < Math.Min(visibleCount + 1, windows.Count); index++) { ShowWindow(windows[index], 4); UpdateWindow(windows[index]); }
                    revealRequested = false; revealed.Set();
                }
                Message message;
                while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref message); DispatchMessage(ref message); }
                Thread.Sleep(5);
            }
        } catch (Exception ex) { error=ex; ready.Set(); }
        finally { foreach (var window in windows) DestroyWindow(window); }
    }
    public void ShowHidden() {
        revealRequested = true;
        if (!revealed.Wait(3000)) throw new TimeoutException("Owned hidden windows did not become visible.");
    }
    public void Dispose() { stopped=true; thread.Join(2000); ready.Dispose(); revealed.Dispose(); }
}
"@

$fixture = [OwnedLivePreviewWindow]::new([bool]$Foreground, $VisibleWindows, $HiddenWindows, [bool]$GrayBackground)
try {
    @{ handle=$fixture.Handle.ToInt64().ToString(); executable=(Get-Process -Id $PID).Path; windowCount=$fixture.WindowCount; visibleWindows=$VisibleWindows; hiddenWindows=$HiddenWindows } | ConvertTo-Json -Compress
    while ($null -ne ($command = [Console]::In.ReadLine())) {
        if ($command -eq 'show-hidden') { $fixture.ShowHidden(); @{ shown=[Math]::Min(1, $HiddenWindows) } | ConvertTo-Json -Compress }
    }
} finally { $fixture.Dispose() }
