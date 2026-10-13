using System.ComponentModel;
using FrameFlow.Capture;

internal static class LiveWindowExclusionsTests
{
    private const string Browser = @"C:\Apps\browser.exe";
    private const string Mate = @"D:\webcast_mate\12.9.3\直播伴侣.exe";
    private const string Red = @"D:\Apps\xhs-live-helper.exe";
    private static RecordingOptions Options(string source = "screen:test", string[]? own = null) =>
        new(source, false, false, 30, null, ExcludeWindowHandles: own);
    private static LiveExcludedWindow Window(int handle, string path = Browser) => new(handle, 50, path);

    internal static async Task RunAsync(Action<bool, string> check)
    {
        check(LiveWindowExclusions.IsDefaultExecutable(Mate) && LiveWindowExclusions.IsDefaultExecutable(Red),
            "legacy defaults identify only the two exact executable basenames");
        check(!LiveWindowExclusions.IsDefaultExecutable(@"C:\Apps\直播浏览器.exe")
            && !LiveWindowExclusions.IsDefaultExecutable(@"C:\Apps\xhs-live-helper-launcher.exe"),
            "similar names and launchers never become implicit exclusion targets");
        check(LiveWindowExclusions.NormalizeApplication(@"C:\Apps\Sub\..\browser.EXE") == @"C:\Apps\browser.EXE",
            "application identity normalizes an absolute executable path");
        foreach (var invalid in new[] { "", "browser.exe", @"C:browser.exe", @"\\server\app.exe", @"\\?\C:\app.exe",
            @"C:\Apps\*.exe", @"C:\Apps\a.exe:stream", @"C:\Apps\a.dll", "C:\\Apps\\a\n.exe", "C:\\" + new string('a', 1024) + ".exe" })
        {
            try { LiveWindowExclusions.NormalizeApplication(invalid); throw new InvalidOperationException("accepted " + invalid); }
            catch (ArgumentException) { check(true, "invalid application path is rejected"); }
        }
        check(LiveWindowExclusions.NormalizeApplications([Browser, Browser.ToUpperInvariant()])?.Length == 1,
            "duplicate application identities compare without case sensitivity");
        try { LiveWindowExclusions.NormalizeApplications(Enumerable.Repeat(Browser, 33).ToArray()); throw new InvalidOperationException(); }
        catch (ArgumentException) { check(true, "application selection retains a bounded input count"); }
        var snapshots = new[] { Window(1, Mate), Window(2, Red), Window(3), Window(4, Browser.ToUpperInvariant()),
            Window(5, @"D:\Other\browser.exe") };
        check(LiveWindowExclusions.Select(snapshots, null).Select(window => window.Handle).SequenceEqual([(nint)1, 2]),
            "omitted application list preserves legacy live defaults");
        check(LiveWindowExclusions.Select(snapshots, []).Length == 0,
            "explicit empty application list disables all third-party exclusions");
        check(LiveWindowExclusions.Select(snapshots, [Browser]).Select(window => window.Handle).SequenceEqual([(nint)3, 4]),
            "selection groups every same-path window without matching another installation");
        check(LiveWindowExclusions.Select(snapshots, [@"C:\Uninstalled\valid.exe"]).Length == 0,
            "a saved but stopped application is valid and contributes no windows");
        var current = LiveWindowExclusions.Current([Window(1), Window(1), Window(2), new(3, 0, Browser)],
            window => window.Handle != 2);
        check(current.SequenceEqual([Window(1)]), "expired windows and duplicate snapshot items are removed");
        var options = Options(own: ["90", "91", "90"]);
        var merged = LiveWindowExclusions.Merge(options, [Window(91), Window(92)]);
        check(merged.ExcludeWindowHandles!.SequenceEqual(["90", "91", "92"])
            && options.ExcludeWindowHandles!.SequenceEqual(["90", "91", "90"]),
            "snapshot merging preserves own windows, deduplicates handles and never mutates options");
        check(LiveWindowExclusions.Merge(Options(own: ["invalid"]), []).ExcludeWindowHandles is ["invalid"],
            "invalid own handles survive merging for strict SourceCatalog validation");
        var windowOptions = Options("window:10", ["90"]);
        check(ReferenceEquals(LiveWindowExclusions.Merge(windowOptions, snapshots), windowOptions),
            "window-source capture keeps its existing exclusion semantics");
        var crop = new CaptureRect(20, 30, 800, 600);
        check(LiveWindowExclusions.Merge(options with { Crop = crop }, [Window(1)]).Crop == crop,
            "region capture retains its crop while sharing screen exclusions");
        var manyWindows = WindowsApplicationCatalog.Build(
            Enumerable.Range(1, 136).Select(value => ((nint)value, (uint)50, value <= 40)),
            new Dictionary<uint, string> { [50] = Browser }, path => new LiveApplication(path, "Browser", "browser.exe"));
        var manySelected = LiveWindowExclusions.Select(manyWindows.Windows, [Browser]);
        var manyMerged = LiveWindowExclusions.Merge(Options(own: ["136", "200"]), manySelected);
        check(manyWindows.Applications.Length == 1 && manySelected.Length == 136,
            "one selected application retains all 40 visible and 96 hidden windows");
        check(manyMerged.ExcludeWindowHandles!.Length == 137
            && manyMerged.ExcludeWindowHandles.Contains("1") && manyMerged.ExcludeWindowHandles.Contains("136")
            && manyMerged.ExcludeWindowHandles.Contains("200"),
            "large application snapshot merges with own windows without truncation or duplicate handles");
        var command = Protocol.Parse("""{"id":1,"command":"live-start","options":{"sourceId":"screen:test","fps":30,"excludedApplications":[]}}""");
        check(command.Options?.ExcludedApplications is { Length: 0 }, "empty application intent survives native protocol parsing");
        check(Protocol.Parse("""{"id":1,"command":"live-applications"}""").CommandName == "live-applications",
            "application enumeration requires no capture options");
        var applications = WindowsApplicationCatalog.Build(
            [((nint)1, (uint)50, true), ((nint)2, (uint)50, false), ((nint)3, (uint)51, false), ((nint)4, (uint)52, true)],
            new Dictionary<uint, string> { [50] = Browser, [51] = Mate },
            path => new LiveApplication(path, Path.GetFileNameWithoutExtension(path), Path.GetFileName(path)));
        check(applications.Applications is [{ Id: Browser }] && applications.Windows.Length == 3,
            "picker shows visible known applications while capture retains their hidden top-level windows");
        await Startup(check);
        await Signals(check);
        await Cleanup(check);
    }

    private sealed class Attempt(int id, RecordingOptions options, List<string> events, Exception? disposeError = null) : IAsyncDisposable
    {
        internal int Id => id;
        internal RecordingOptions Options => options;
        public ValueTask DisposeAsync() { events.Add("dispose:" + id); return disposeError is null ? ValueTask.CompletedTask : ValueTask.FromException(disposeError); }
    }

    private static async Task Startup(Action<bool, string> check)
    {
        var events = new List<string>();
        var alive = true;
        var count = 0;
        var failure = new ArgumentException("录制悬浮窗已关闭，请重新开始录制。");
        var started = await LiveCaptureStartup.RunAsync(Options(own: ["90"]), [Window(1)],
            _ => alive, _ => true,
            options => { events.Add("create:" + ++count); return new Attempt(count, options, events); },
            (attempt, _) =>
            {
                if (attempt.Id != 1) return Task.CompletedTask;
                alive = false;
                return Task.FromException(failure);
            }, CancellationToken.None);
        check(events.SequenceEqual(["create:1", "dispose:1", "create:2"])
            && started.Options.ExcludeWindowHandles is ["90"],
            "closed third-party startup retry releases the first session and removes only expired windows");
        await started.DisposeAsync();
        check(LiveCaptureStartup.IsExclusionHandleError(new LiveCaptureBackendException("Failed to start capture : "
            + new Win32Exception(87).Message)), "localized backend invalid-argument error remains identifiable");
        foreach (var reason in new Exception[] { new InvalidOperationException("device failure"),
            new PlatformNotSupportedException("unsupported Windows"), new TimeoutException(), new OperationCanceledException(),
            new LiveCaptureBackendException("graphics device lost") })
        {
            alive = true; count = 0; events.Clear();
            try
            {
                await LiveCaptureStartup.RunAsync(Options(), [Window(1)], _ => alive, _ => true,
                    options => new Attempt(++count, options, events),
                    (_, _) => { alive = false; return Task.FromException(reason); }, CancellationToken.None);
                throw new InvalidOperationException("unrelated error was swallowed");
            }
            catch (Exception error) when (ReferenceEquals(error, reason))
            { check(count == 1 && events.SequenceEqual(["dispose:1"]), "unrelated startup errors propagate after cleanup without retry"); }
        }
        foreach (var ownValid in new[] { false, true })
        {
            count = 0; alive = true; events.Clear();
            try
            {
                await LiveCaptureStartup.RunAsync(Options(own: ["90"]), [Window(1)], _ => alive, _ => ownValid,
                    options => new Attempt(++count, options, events),
                    (_, _) => { if (!ownValid) alive = false; return Task.FromException(failure); }, CancellationToken.None);
                throw new InvalidOperationException();
            }
            catch (ArgumentException)
            { check(count == 1 && events.Count == 1, "retry requires expired third-party windows and valid own windows"); }
        }
        count = 0; events.Clear(); var liveHandles = new HashSet<nint> { 1, 2 };
        try
        {
            await LiveCaptureStartup.RunAsync(Options(), [Window(1), Window(2)], window => liveHandles.Contains(window.Handle), _ => true,
                options => new Attempt(++count, options, events),
                (attempt, _) => { liveHandles.Remove(attempt.Id); return Task.FromException(failure); }, CancellationToken.None);
            throw new InvalidOperationException();
        }
        catch (ArgumentException)
        { check(count == 2 && events.SequenceEqual(["dispose:1", "dispose:2"]), "startup retries are bounded and every failed attempt is disposed"); }
        using var cancel = new CancellationTokenSource();
        cancel.Cancel(); count = 0;
        try
        {
            await LiveCaptureStartup.RunAsync(Options(), [], _ => true, _ => true,
                options => new Attempt(++count, options, events), (_, _) => Task.CompletedTask, cancel.Token);
            throw new InvalidOperationException();
        }
        catch (OperationCanceledException) { check(count == 0, "cancelled startup creates no capture session"); }
    }

    private static async Task Cleanup(Action<bool, string> check)
    {
        var order = new List<string>();
        var inputFailure = new InvalidOperationException("input cleanup");
        var recorderFailure = new InvalidOperationException("recorder cleanup");
        try
        {
            await LiveCaptureStartup.CleanupAsync(
                () => { order.Add("input"); return ValueTask.FromException(inputFailure); },
                () => { order.Add("pipe"); return ValueTask.CompletedTask; },
                () => { order.Add("recorder"); return ValueTask.FromException(recorderFailure); });
            throw new InvalidOperationException();
        }
        catch (AggregateException error)
        {
            check(order.SequenceEqual(["input", "pipe", "recorder"])
                && error.InnerExceptions.SequenceEqual([inputFailure, recorderFailure]),
                "resource cleanup attempts every resource and retains every cleanup error");
        }
        order.Clear();
        await LiveCaptureStartup.CleanupAsync(
            () => { order.Add("input"); return ValueTask.CompletedTask; },
            () => { order.Add("pipe"); return ValueTask.CompletedTask; });
        check(order.SequenceEqual(["input", "pipe"]), "successful resource cleanup runs each release exactly once");
        var alive = true;
        var created = 0;
        var original = new ArgumentException("录制悬浮窗已关闭，请重新开始录制。");
        try
        {
            await LiveCaptureStartup.RunAsync(Options(), [Window(1)], _ => alive, _ => true,
                options => new Attempt(++created, options, order, inputFailure),
                (_, _) => { alive = false; return Task.FromException(original); }, CancellationToken.None);
            throw new InvalidOperationException();
        }
        catch (AggregateException error)
        {
            check(created == 1 && error.InnerExceptions.SequenceEqual([original, inputFailure]),
                "cleanup failure prevents retry and retains the original startup error");
        }
    }

    private static async Task Signals(Action<bool, string> check)
    {
        var forwarded = new List<Exception>();
        var failure = new InvalidOperationException("first frame failed");
        var signal = new LiveCaptureStartupSignal(forwarded.Add);
        signal.Fail(failure);
        try { await signal.WaitForFrameAsync(new TaskCompletionSource().Task, CancellationToken.None); throw new InvalidOperationException(); }
        catch (Exception error) when (ReferenceEquals(error, failure))
        { check(forwarded.Count == 0, "initial-frame failure faults startup without broadcasting a premature live-error"); }
        var next = new LiveCaptureStartupSignal(forwarded.Add);
        await next.WaitForFrameAsync(Task.CompletedTask, CancellationToken.None);
        next.Fail(failure);
        try { next.Activate(); throw new InvalidOperationException(); }
        catch (Exception error) when (ReferenceEquals(error, failure))
        { check(forwarded.Count == 0, "failure between first frame and activation remains a startup failure"); }
        var active = new LiveCaptureStartupSignal(forwarded.Add);
        active.Activate(); active.Fail(failure); active.Close(); active.Fail(new Exception("late"));
        check(forwarded.SequenceEqual([failure]), "only active errors are forwarded and disposed sessions ignore late callbacks");
    }
}
