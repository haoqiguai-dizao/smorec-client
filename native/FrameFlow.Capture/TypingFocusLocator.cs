namespace FrameFlow.Capture;

// Calls from the raw-input thread never wait for an accessibility provider. At most one
// UIA call runs per process; a hung provider cannot create unbounded workers or stop recording.
internal sealed class TypingFocusLocator(CaptureClock clock, Func<Win32.Rect> bounds, CaptureRect? crop,
    nint sourceWindow, IReadOnlySet<nint> excluded) : IDisposable
{
    private sealed record Snapshot(double RequestedAt, InputFocus Focus, int Generation, double[]? Rect);
    private static int probeRunning;
    private Snapshot? snapshot;
    private double requestedAt = double.NegativeInfinity;
    private int generation, disposed;
    private IReadOnlySet<nint> currentExclusions = excluded;
    internal void SetExcludedWindows(IReadOnlySet<nint> value) { currentExclusions = value; Invalidate(); }

    internal InputActivityFocus? Read(double time, InputFocus current)
    {
        if (Volatile.Read(ref disposed) != 0 || !TypingFocusWin32.Permitted(current, sourceWindow, currentExclusions)) return null;
        var captureBounds = bounds();
        if (TypingFocusWin32.Caret(current) is { } caret)
            return TypingFocusGeometry.Normalize(caret.X, caret.Y, captureBounds, crop);
        var cached = Volatile.Read(ref snapshot);
        Request(time, current);
        if (cached is null || cached.Focus != current || cached.Generation != Volatile.Read(ref generation)
            || time - cached.RequestedAt is < 0 or > .3 || cached.Rect is null) return null;
        return TypingFocusGeometry.EditorCenter(cached.Rect, captureBounds, crop);
    }

    internal void Invalidate()
    {
        Interlocked.Increment(ref generation);
        Volatile.Write(ref snapshot, null);
        requestedAt = double.NegativeInfinity;
    }

    private void Request(double time, InputFocus current)
    {
        if (!OperatingSystem.IsWindows() || time - requestedAt < .15
            || Interlocked.CompareExchange(ref probeRunning, 1, 0) != 0) return;
        requestedAt = time;
        var requestedGeneration = Volatile.Read(ref generation);
        var worker = new Thread(() =>
        {
            try
            {
                if (!OperatingSystem.IsWindows()) return;
                var rect = TypingFocusAutomation.ReadEditorBounds(current);
                if (Volatile.Read(ref disposed) == 0 && requestedGeneration == Volatile.Read(ref generation)
                    && clock.Seconds - time <= .3)
                    Volatile.Write(ref snapshot, new Snapshot(time, current, requestedGeneration, rect));
            }
            catch (Exception) { /* Accessibility is optional; preserve the click-anchor fallback. */ }
            finally { Interlocked.Exchange(ref probeRunning, 0); }
        }) { IsBackground = true, Name = "Typing focus geometry" };
        try { worker.SetApartmentState(ApartmentState.MTA); worker.Start(); }
        catch (Exception) { Interlocked.Exchange(ref probeRunning, 0); }
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref disposed, 1);
        Invalidate();
    }
}
