using System.Diagnostics;
using System.Runtime.InteropServices;
using FrameFlow.Capture;

internal static class TypingInputLifecycleTests
{
    private static RawKeyboardActivityCollector Create() => new(new CaptureClock(), (_, _) => { }, _ => { });

    internal static void Run(Action<bool, string> check)
    {
        if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Typing lifecycle checks require Windows.");
        check(RawKeyboardActivityCollector.ReadRegistrations().Length == 0,
            "isolated typing test process starts with no raw input registration");
        using (var cancelled = Create())
        {
            check(RawMousePacketTests.Throws<OperationCanceledException>(() => cancelled.Start(new CancellationToken(true))),
                "pre-cancelled keyboard startup does not register");
            check(cancelled.ThreadExited && RawKeyboardActivityCollector.ReadRegistrations().Length == 0,
                "pre-cancellation leaves no keyboard thread or registration");
        }
        using (var stopped = Create())
        {
            check(stopped.Stop() && stopped.Stop(), "keyboard stop before start is idempotent");
            check(RawMousePacketTests.Throws<OperationCanceledException>(() => stopped.Start()),
                "a stopped keyboard collector cannot register late");
        }
        using (var first = Create())
        using (var second = Create())
        {
            first.Start();
            VerifyRunning(first, check);
            check(RawMousePacketTests.Throws<InvalidOperationException>(() => first.Start()),
                "keyboard duplicate start is rejected");
            check(RawMousePacketTests.Throws<InvalidOperationException>(() => second.Start()),
                "a second keyboard collector cannot replace the active registration");
            VerifyStopped(first, check);
            second.Start();
            VerifyRunning(second, check);
            VerifyStopped(second, check);
        }
        for (var i = 0; i < 8; i++)
        {
            var collector = Create();
            try
            {
                collector.Start();
                VerifyRunning(collector, check);
                VerifyStopped(collector, check);
            }
            finally { collector.Dispose(); collector.Dispose(); }
            check(RawMousePacketTests.Throws<ObjectDisposedException>(() => collector.Start()),
                "disposed keyboard collector cannot restart");
        }
        for (var i = 0; i < 12; i++)
        {
            using var collector = Create();
            using var cancellation = new CancellationTokenSource();
            cancellation.CancelAfter(1);
            try { collector.Start(cancellation.Token); } catch (OperationCanceledException) { }
            check(collector.Stop() && collector.ThreadExited && RawKeyboardActivityCollector.ReadRegistrations().Length == 0,
                "keyboard cancellation race unregisters and joins every late startup");
        }
        using (var failing = new RawKeyboardActivityCollector(new CaptureClock(), (_, _) => { },
            _ => throw new InvalidOperationException("Controlled timer failure")))
        {
            failing.Start();
            check(SpinWait.SpinUntil(() => failing.ThreadExited, TimeSpan.FromSeconds(2)),
                "activity consumer failure exits the keyboard input thread without injected input");
            check(failing.Error is not null && failing.RegistrationRemoved
                && RawKeyboardActivityCollector.ReadRegistrations().Length == 0,
                "activity failure retains an error and removes keyboard registration");
        }
        using (var mouse = new RawMouseInputCollector(new CaptureClock(), "raw"))
        using (var keyboard = Create())
        {
            mouse.Start();
            keyboard.Start();
            var registrations = RawKeyboardActivityCollector.ReadRegistrations();
            check(registrations.Length == 2 && registrations.All(item => item.Flags == 0x0100)
                && registrations.Select(item => item.Usage).Order().SequenceEqual(new ushort[] { 2, 6 }),
                "mouse and keyboard INPUTSINK registrations coexist without changing mouse flags");
            keyboard.Stop();
            registrations = RawKeyboardActivityCollector.ReadRegistrations();
            check(registrations.Length == 1 && registrations[0].Usage == 2 && !mouse.ThreadExited,
                "keyboard cleanup leaves the mouse collector and its registration intact");
            mouse.Stop();
        }
        check(RawKeyboardActivityCollector.ReadRegistrations().Length == 0,
            "typing lifecycle suite leaves no process registrations");
    }

    private static void VerifyRunning(RawKeyboardActivityCollector collector, Action<bool, string> check)
    {
        var registrations = RawKeyboardActivityCollector.ReadRegistrations();
        check(!collector.ThreadExited && collector.Error is null && collector.RegistrationVerified,
            "keyboard collector starts and verifies its native registration without a hook");
        check(registrations.Length == 1 && registrations[0].UsagePage == 1 && registrations[0].Usage == 6
            && registrations[0].Flags == 0x0100, "keyboard OS registration is only Usage 1/6 INPUTSINK, with no NOLEGACY");
        var window = registrations[0].Target;
        Win32.GetWindowThreadProcessId(window, out var processId);
        check(Win32.IsWindow(window) && processId == Environment.ProcessId && !IsWindowVisible(window),
            "keyboard target is an owned, hidden message window");
    }

    private static void VerifyStopped(RawKeyboardActivityCollector collector, Action<bool, string> check)
    {
        var window = RawKeyboardActivityCollector.ReadRegistrations().Single().Target;
        var elapsed = Stopwatch.StartNew();
        check(collector.Stop() && collector.Stop(), "keyboard stop is idempotent and joins its thread");
        check(elapsed.Elapsed < TimeSpan.FromSeconds(2) && collector.ThreadExited && collector.RegistrationRemoved
            && collector.Error is null && !Win32.IsWindow(window) && RawKeyboardActivityCollector.ReadRegistrations().Length == 0,
            "keyboard stop destroys its window, removes registration and exits within the deadline");
    }

    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint window);
}
