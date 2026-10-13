using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace FrameFlow.Capture;

internal sealed class CursorRecorder : IDisposable
{
    private readonly CaptureClock clock;
    private readonly SourceSelection selection;
    private readonly Action<Exception> failure;
    private readonly Action<string> warning;
    private readonly SessionDiagnostics log;
    private readonly string backend;
    private readonly bool detailsEnabled;
    private readonly RawMouseInputCollector? input;
    private readonly Action<double, Win32.Point, bool>? observeClick;
    private readonly StreamWriter journal;
    private readonly CancellationTokenSource cancellation = new();
    private readonly object stopGate = new();
    private readonly nint hand = Win32.LoadCursor(0, (nint)32649);
    private readonly nint ibeam = Win32.LoadCursor(0, (nint)32513);
    private Task? sampling;
    private Task? stopTask;
    private string lastShape = "arrow";
    private bool disposed;
    private int diagnosticsWritten;
    private bool inputErrorReported, inputWarningReported;
    private IReadOnlySet<nint> excluded = new HashSet<nint>();
    internal void SetExcludedWindows(string[]? handles) => Volatile.Write(ref excluded,
        (handles ?? []).Select(value => long.TryParse(value, out var id) ? (nint)id : 0).Where(value => value != 0).ToHashSet());

    internal CursorRecorder(string directory, CaptureClock clock, SourceSelection selection, Action<Exception> failure,
        SessionDiagnostics log, Action<string> warning, Action<double, Win32.Point, bool>? observeClick = null)
    {
        this.clock = clock;
        this.selection = selection;
        this.failure = failure;
        this.warning = warning;
        this.log = log;
        this.observeClick = observeClick;
        backend = string.Equals(Environment.GetEnvironmentVariable("FRAMEFLOW_CAPTURE_MOUSE_HOOK"), "off",
            StringComparison.OrdinalIgnoreCase) ? "disabled"
            : Environment.GetEnvironmentVariable("FRAMEFLOW_CAPTURE_MOUSE_BACKEND")?.ToLowerInvariant() ?? "raw";
        if (backend != "disabled") input = new RawMouseInputCollector(clock, backend);
        detailsEnabled = Environment.GetEnvironmentVariable("FRAMEFLOW_CAPTURE_INPUT_DIAGNOSTICS") == "1";
        journal = new StreamWriter(new FileStream(Path.Combine(directory, "cursor.recovery.jsonl"),
            FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(false));
    }

    internal void Start(CancellationToken cancellation = default)
    {
        cancellation.ThrowIfCancellationRequested();
        input?.Start(cancellation);
        sampling = Task.Run(SampleLoop);
    }

    private async Task SampleLoop()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1d / 60));
        var flushAt = 0d;
        try
        {
            do
            {
                ReportInputWarnings();
                var info = new Win32.CursorInfo { Size = Marshal.SizeOf<Win32.CursorInfo>() };
                var available = Win32.GetCursorInfo(ref info);
                var shape = info.Handle == hand ? "hand" : info.Handle == ibeam ? "ibeam" : "arrow";
                lastShape = shape;
                DrainClicks();
                var elapsed = clock.Seconds;
                Write(elapsed, info.Position, available && (info.Flags & 1) != 0, false, shape);
                if (elapsed >= flushAt) { await journal.FlushAsync(); flushAt = elapsed + 1; }
            } while (await timer.WaitForNextTickAsync(cancellation.Token));
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { failure(ex); }
    }

    private void DrainClicks()
    {
        while (input is not null && input.TryDequeue(out var click))
            Write(click.Time, click.Point, true, true, lastShape);
    }

    private void ReportInputWarnings()
    {
        if (!inputErrorReported && input?.Error is { } error)
        {
            inputErrorReported = true;
            warning("鼠标点击采集出现异常，视频仍会保存，部分点击标记可能缺失。" + error.Message);
        }
        if (!inputWarningReported && input?.Warning is { } detail)
        {
            inputWarningReported = true;
            warning("部分鼠标点击标记未能采集，视频仍会保存。" + detail);
        }
    }

    private void Write(double time, Win32.Point point, bool visible, bool click, string shape)
    {
        var bounds = selection.Bounds();
        var crop = selection.Crop;
        var width = crop?.Width ?? bounds.Width;
        var height = crop?.Height ?? bounds.Height;
        var x = width > 0 ? (point.X - bounds.Left - (crop?.X ?? 0)) / width : -1;
        var y = height > 0 ? (point.Y - bounds.Top - (crop?.Y ?? 0)) / height : -1;
        var exclusions = Volatile.Read(ref excluded);
        var blocked = exclusions.Count > 0 && TypingFocusWin32.IsExcludedAtPoint(point, exclusions);
        if (blocked) { visible = false; click = false; }
        var sample = new CursorSample(time, Math.Clamp(x, 0, 1), Math.Clamp(y, 0, 1),
            visible && bounds.Width > 0 && x >= 0 && x <= 1 && y >= 0 && y <= 1, click, shape,
            click || blocked || backend == "disabled" ? null : RawInputWin32.PrimaryDown());
        if (click) observeClick?.Invoke(time, point, sample.Visible);
        journal.WriteLine(JsonSerializer.Serialize(sample, Protocol.Json));
    }

    internal Task StopAsync()
    {
        lock (stopGate) return stopTask ??= StopCoreAsync();
    }

    private async Task StopCoreAsync()
    {
        var exited = input?.Stop() ?? true;
        cancellation.Cancel();
        if (sampling is not null) await sampling;
        DrainClicks();
        ReportInputWarnings();
        if (!exited) warning("鼠标采集清理尚未完成，视频仍会保存，请退出应用后再开始下一次录制。");
        WriteInputDiagnostics();
        await journal.FlushAsync();
    }

    internal static async Task FinalizeAsync(string directory, double origin, double duration)
    {
        using var output = new StreamWriter(Path.Combine(directory, "cursor.json"), false, new UTF8Encoding(false));
        await output.WriteAsync("[");
        var first = true;
        var lastTime = 0d;
        // A streaming conversion keeps hours-long recordings bounded in memory.
        foreach (var line in File.ReadLines(Path.Combine(directory, "cursor.recovery.jsonl")))
        {
            var sample = JsonSerializer.Deserialize<CursorSample>(line, Protocol.Json);
            if (sample is null || sample.T < origin || sample.T > origin + duration) continue;
            if (!first) await output.WriteAsync(",");
            lastTime = Math.Max(lastTime, sample.T - origin);
            await output.WriteAsync(JsonSerializer.Serialize(sample with { T = lastTime }, Protocol.Json));
            first = false;
        }
        await output.WriteAsync("]");
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        try { StopAsync().GetAwaiter().GetResult(); }
        catch (Exception ex) { log.Write("cursor-stop-error", new { error = ex.Message }); }
        input?.Dispose();
        journal.Dispose();
        cancellation.Dispose();
    }

    private void WriteInputDiagnostics()
    {
        if (Interlocked.Exchange(ref diagnosticsWritten, 1) != 0) return;
        log.Write("cursor-input-diagnostics", new
        {
            backend, hookEnabled = false, detailsEnabled,
            hookThreadExited = true, inputThreadExited = input?.ThreadExited ?? true,
            metrics = (object?)null, input = input?.Snapshot()
        });
    }
}
