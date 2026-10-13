namespace FrameFlow.Capture;

internal sealed class InputActivityRecorder : IDisposable
{
    private readonly record struct Click(double Time, Win32.Point Point, bool InRecording);
    private readonly CaptureClock clock;
    private readonly Action<string> warning;
    private readonly SessionDiagnostics log;
    private readonly nint sourceWindow;
    private IReadOnlySet<nint> excluded;
    private readonly object activityGate = new();
    private readonly BoundedActivityQueue<Click> clicks = new(128);
    private readonly BoundedActivityQueue<InputActivitySample> events = new(512);
    private readonly InputActivityEventBuffer pending = new(2048);
    private readonly RawKeyboardActivityCollector collector;
    private readonly TypingActivityState state;
    private readonly TypingFocusLocator focusLocator;
    private InputFocus lastFocus;
    private (double Time, InputFocus Focus)? pendingTyping;
    private readonly InputActivityJournal journal;
    private readonly CancellationTokenSource cancellation = new();
    private readonly object stopGate = new();
    private Task? writing, stopTask;
    private int accepting = 1;
    private bool disposed;

    internal InputActivityRecorder(string directory, CaptureClock clock, RecordingOptions options, SourceSelection selection,
        SessionDiagnostics log, Action<string> warning)
    {
        this.clock = clock;
        this.warning = warning;
        this.log = log;
        sourceWindow = options.SourceId.StartsWith("window:", StringComparison.Ordinal)
            && long.TryParse(options.SourceId[7..], out var handle) ? (nint)handle : 0;
        excluded = (options.ExcludeWindowHandles ?? []).Select(value => long.TryParse(value, out var id) ? (nint)id : 0)
            .Where(value => value != 0).ToHashSet();
        journal = new InputActivityJournal(directory);
        state = new TypingActivityState(EnqueueEvent);
        focusLocator = new TypingFocusLocator(clock, selection.Bounds, selection.Crop, sourceWindow, excluded);
        collector = new RawKeyboardActivityCollector(clock, OnKey, OnTick);
    }

    internal void Start(CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        writing = Task.Run(WriteLoop);
        try { collector.Start(token); }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (Exception ex) { collector.SetError(ex); }
    }

    internal void ObserveClick(double time, Win32.Point point, bool inRecording)
    {
        if (Volatile.Read(ref accepting) == 0 || collector.Error is not null) return;
        if (!clicks.TryEnqueue(new Click(time, point, inRecording)))
            collector.SetError(new InvalidOperationException("Typing click anchor queue overflowed; activity capture stopped."));
    }

    private void DrainClicks(double now)
    {
        while (clicks.TryDequeue(out var click))
        {
            // A delayed focus lookup cannot establish where an old click actually landed.
            var recent = now - click.Time is >= 0 and <= .2;
            var focus = recent
                ? TypingFocusWin32.AtClick(click.Point, click.InRecording, sourceWindow, excluded) : default;
            focusLocator.Invalidate();
            pendingTyping = null;
            state.Click(recent ? click.Time : now, focus);
        }
    }

    private void OnTick(double time)
    {
        lock (activityGate) Tick(time);
    }
    private void Tick(double time)
    {
        if (Volatile.Read(ref accepting) == 0) return;
        DrainClicks(time);
        var current = ReadFocus();
        state.CheckFocus(time, current);
        if (pendingTyping is not { } typing) return;
        if (typing.Focus != current || time - typing.Time > .3) { pendingTyping = null; return; }
        if (focusLocator.Read(time, current) is not { } position) return;
        state.Key(time, TypingKeyAction.Typing, current, position);
        pendingTyping = null;
    }

    private void OnKey(double time, TypingKeyAction action)
    {
        lock (activityGate) Key(time, action);
    }
    private void Key(double time, TypingKeyAction action)
    {
        if (Volatile.Read(ref accepting) == 0) return;
        DrainClicks(time);
        var current = ReadFocus();
        if (action == TypingKeyAction.Reset) { focusLocator.Invalidate(); pendingTyping = null; }
        var position = action == TypingKeyAction.Typing ? focusLocator.Read(time, current) : null;
        state.Key(time, action, current, position);
        if (action == TypingKeyAction.Typing) pendingTyping = position is null ? (time, current) : null;
    }

    private InputFocus ReadFocus()
    {
        var current = TypingFocusWin32.Read();
        if (lastFocus != current) { focusLocator.Invalidate(); pendingTyping = null; lastFocus = current; }
        return current;
    }
    internal void SetExcludedWindows(string[]? handles)
    {
        var next = (handles ?? []).Select(value => long.TryParse(value, out var id) ? (nint)id : 0)
            .Where(value => value != 0).ToHashSet();
        lock (activityGate)
        {
            excluded = next; focusLocator.SetExcludedWindows(next);
            pendingTyping = null; lastFocus = default;
            state.Key(clock.Seconds, TypingKeyAction.Reset, default, null);
        }
    }

    private void EnqueueEvent(InputActivitySample sample)
    {
        if (collector.Error is not null) return;
        if (!events.TryEnqueue(sample))
            collector.SetError(new InvalidOperationException("Typing event queue overflowed; activity capture stopped."));
    }

    private async Task WriteLoop()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(50));
        var resetWritten = false;
        var flushAt = 0d;
        try
        {
            do
            {
                DrainEvents(final: false);
                if (collector.Error is not null && !resetWritten)
                {
                    // Queue overflow must end any hold even when the lost event was a reset.
                    var reset = new InputActivitySample(clock.Seconds, "reset");
                    if (!pending.TryAdd(reset))
                    {
                        pending.DrainThrough(double.PositiveInfinity, journal.Write);
                        journal.Write(reset);
                    }
                    resetWritten = true;
                }
                if (clock.Seconds >= flushAt) { await journal.FlushAsync(); flushAt = clock.Seconds + 1; }
            } while (await timer.WaitForNextTickAsync(cancellation.Token));
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { collector.SetError(ex); }
    }

    private void DrainEvents(bool final)
    {
        while (events.TryDequeue(out var sample))
        {
            if (!pending.TryAdd(sample))
            {
                collector.SetError(new InvalidOperationException("Typing reorder buffer overflowed; activity capture stopped."));
                continue;
            }
        }
        // The mouse observer runs at 60 Hz; retain a bounded window so click resets keep their own timestamp.
        var through = final ? double.PositiveInfinity : clock.Seconds - .35;
        pending.DrainThrough(through, journal.Write);
    }

    internal Task StopAsync()
    {
        lock (stopGate) return stopTask ??= StopCoreAsync();
    }

    private async Task StopCoreAsync()
    {
        Interlocked.Exchange(ref accepting, 0);
        var exited = collector.Stop();
        if (exited) state.FlushFocusReset(double.PositiveInfinity);
        cancellation.Cancel();
        if (writing is not null) await writing;
        try
        {
            DrainEvents(final: true);
            journal.Write(new InputActivitySample(clock.Seconds, "reset"));
            await journal.FlushAsync();
        }
        catch (Exception ex) { collector.SetError(ex); }
        if (collector.Error is not null) warning("输入活动采集不可用，视频仍会保存，部分输入镜头可能不会保持缩放。");
        if (!exited) warning("输入活动采集清理尚未完成，请退出应用后再开始下一次录制。");
        log.Write("typing-input-diagnostics", new
        {
            backend = "raw", usagePage = 1, usage = 6, hookEnabled = false,
            registrationFlags = RawInputWin32.InputSink, collector.RegistrationVerified,
            collector.RegistrationRemoved, inputThreadExited = collector.ThreadExited,
            failed = collector.Error is not null
        });
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        try { StopAsync().GetAwaiter().GetResult(); }
        finally { collector.Dispose(); focusLocator.Dispose(); journal.Dispose(); cancellation.Dispose(); }
    }
}
