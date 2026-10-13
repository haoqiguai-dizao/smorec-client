using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using FrameFlow.Capture;

internal static class MouseInputLifecycleTests
{
    internal static void Run(Action<bool, string> check)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Mouse lifecycle checks require Windows.");
        check(IntPtr.Size == 8, "mouse lifecycle runs in the supported Windows x64 process");
        check(Registrations().Length == 0, "isolated test process initially owns no raw-input registrations");
        using (var cancelled = new RawMouseInputCollector(new CaptureClock(), "raw"))
        {
            check(RawMousePacketTests.Throws<OperationCanceledException>(() => cancelled.Start(new CancellationToken(true))),
                "pre-cancelled startup never registers or starts a collector");
            check(cancelled.Snapshot().InputThreadExited && Registrations().Length == 0,
                "pre-cancelled startup leaves no thread or registration");
        }
        using (var stopped = new RawMouseInputCollector(new CaptureClock(), "raw"))
        {
            check(stopped.Stop() && stopped.Stop(), "stop before start is idempotent");
            check(RawMousePacketTests.Throws<OperationCanceledException>(() => stopped.Start()),
                "a stopped collector cannot register late");
        }
        using (var first = new RawMouseInputCollector(new CaptureClock(), "raw"))
        using (var second = new RawMouseInputCollector(new CaptureClock(), "raw"))
        {
            first.Start();
            VerifyRunning(first, check);
            check(RawMousePacketTests.Throws<InvalidOperationException>(() => first.Start()), "starting a live collector twice is rejected");
            check(RawMousePacketTests.Throws<InvalidOperationException>(() => second.Start()),
                "a second collector cannot replace the process-wide raw mouse registration");
            VerifyStopped(first, check);
            second.Start();
            VerifyRunning(second, check);
            VerifyStopped(second, check);
        }
        for (var i = 0; i < 8; i++)
        {
            var collector = new RawMouseInputCollector(new CaptureClock(), "raw");
            try
            {
                collector.Start();
                VerifyRunning(collector, check);
                VerifyStopped(collector, check);
            }
            finally { collector.Dispose(); collector.Dispose(); }
            check(RawMousePacketTests.Throws<ObjectDisposedException>(() => collector.Start()), "disposed collector cannot restart");
        }
        for (var i = 0; i < 12; i++)
        {
            using var collector = new RawMouseInputCollector(new CaptureClock(), "raw");
            using var cancel = new CancellationTokenSource();
            cancel.CancelAfter(1);
            try { collector.Start(cancel.Token); } catch (OperationCanceledException) { }
            check(collector.Stop() && collector.Snapshot().InputThreadExited && Registrations().Length == 0,
                "startup cancellation race is bounded and cannot retain a late registration");
        }
        using (var poll = new RawMouseInputCollector(new CaptureClock(), "poll"))
        {
            poll.Start();
            check(poll.Snapshot().Backend == "poll" && !poll.Snapshot().HookEnabled && Registrations().Length == 0,
                "explicit poll compatibility does not register raw input or a global hook");
            check(poll.Stop() && poll.Snapshot().InputThreadExited, "poll wait is promptly interrupted by stop");
        }
        check(Registrations().Length == 0, "all collector tests leave the process registration list empty");
        Console.WriteLine("MOUSE_LIFECYCLE " + JsonSerializer.Serialize(new
        {
            result = "PASS", physicalInputRequired = false, inputInjected = false,
            captureActivated = false, userCoordinatesRecorded = false,
            coverage = "Actual hidden HWND registration/readback/removal and thread lifecycle only; not physical WM_INPUT throughput"
        }));
    }

    private static void VerifyRunning(RawMouseInputCollector collector, Action<bool, string> check)
    {
        var snapshot = collector.Snapshot();
        var devices = Registrations();
        var window = (nint)snapshot.RegisteredWindow;
        Win32.GetWindowThreadProcessId(window, out var processId);
        check(snapshot.Backend == "raw" && !snapshot.HookEnabled && !snapshot.InputThreadExited && snapshot.Error is null,
            "raw collector is running without a low-level hook or startup error");
        check(snapshot.RegistrationVerified && snapshot.RegisteredFlags == 0x0100
            && devices.Length == 1 && devices[0].UsagePage == 1 && devices[0].Usage == 2
            && devices[0].Flags == 0x0100 && devices[0].Target == window,
            "OS registration readback is exactly mouse INPUTSINK, without NOLEGACY or CAPTUREMOUSE");
        check(Win32.IsWindow(window) && processId == Environment.ProcessId && !IsWindowVisible(window),
            "registered target is an existing hidden HWND owned by this test process");
    }

    private static void VerifyStopped(RawMouseInputCollector collector, Action<bool, string> check)
    {
        var window = (nint)collector.Snapshot().RegisteredWindow;
        var timer = Stopwatch.StartNew();
        check(collector.Stop() && collector.Stop(), "raw stop is idempotent and joins the input thread");
        var snapshot = collector.Snapshot();
        var remaining = Registrations();
        var windowRemains = Win32.IsWindow(window);
        Console.WriteLine("MOUSE_STOP " + JsonSerializer.Serialize(new
        {
            snapshot.Backend, snapshot.HookEnabled, snapshot.InputThreadExited, snapshot.RegistrationVerified,
            snapshot.RegisteredFlags, snapshot.RegistrationRemoved, snapshot.InputCount, snapshot.ButtonCount,
            snapshot.ParseErrorCount, snapshot.OverflowCount, snapshot.Error,
            stopMilliseconds = timer.Elapsed.TotalMilliseconds, windowRemains,
            remainingRegistrationCount = remaining.Length
        }));
        check(timer.Elapsed < TimeSpan.FromSeconds(2) && snapshot.InputThreadExited && snapshot.RegistrationRemoved
            && snapshot.Error is null && !windowRemains && remaining.Length == 0,
            "stop destroys the owned HWND, removes OS registration and exits within the shutdown deadline");
    }

    private static RawInputWin32.Device[] Registrations()
    {
        uint count = 0;
        var size = (uint)Marshal.SizeOf<RawInputWin32.Device>();
        if (RawInputWin32.GetRegisteredRawInputDevices(null, ref count, size) == uint.MaxValue)
            throw new InvalidOperationException("Cannot query this process's raw input registration count.");
        if (count == 0) return [];
        var devices = new RawInputWin32.Device[count];
        if (RawInputWin32.GetRegisteredRawInputDevices(devices, ref count, size) == uint.MaxValue)
            throw new InvalidOperationException("Cannot read this process's raw input registrations.");
        return devices;
    }

    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint window);
}
