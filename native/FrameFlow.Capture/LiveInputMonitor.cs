using System.Runtime.InteropServices;

namespace FrameFlow.Capture;

internal sealed class LiveInputMonitor : IAsyncDisposable
{
    private readonly CaptureClock clock;
    private readonly SourceSelection selection;
    private readonly RawMouseInputCollector mouse;
    private readonly RawKeyboardActivityCollector keyboard;
    private readonly TypingActivityState typing;
    private readonly TypingFocusLocator locator;
    private readonly BoundedActivityQueue<InputActivitySample> activity = new(128);
    private readonly BoundedActivityQueue<CursorClick> clicks = new(128);
    private readonly IReadOnlySet<nint> excluded;
    private readonly nint sourceWindow;
    private readonly CancellationTokenSource stopped = new();
    private readonly nint hand = Win32.LoadCursor(0, (nint)32649), ibeam = Win32.LoadCursor(0, (nint)32513);
    private Task? sampling;
    private (double Time, InputFocus Focus)? pendingTyping;
    private InputFocus previousFocus;

    internal LiveInputMonitor(CaptureClock clock, SourceSelection selection, RecordingOptions options)
    {
        this.clock = clock; this.selection = selection;
        sourceWindow = options.SourceId.StartsWith("window:", StringComparison.Ordinal)
            && long.TryParse(options.SourceId[7..], out var handle) ? (nint)handle : 0;
        excluded = (options.ExcludeWindowHandles ?? []).Select(v => long.TryParse(v, out var h) ? (nint)h : 0).ToHashSet();
        mouse = new RawMouseInputCollector(clock, "raw");
        typing = new TypingActivityState(EnqueueActivity);
        locator = new TypingFocusLocator(clock, selection.Bounds, selection.Crop, sourceWindow, excluded);
        keyboard = new RawKeyboardActivityCollector(clock, Key, Tick);
    }

    private void EnqueueActivity(InputActivitySample sample)
    {
        if (!activity.TryEnqueue(sample))
            keyboard.SetError(new InvalidOperationException("直播输入队列已满，请重新开始投屏。"));
    }

    internal void Start(CancellationToken token)
    {
        mouse.Start(token); keyboard.Start(token);
        sampling = Task.Run(Sample);
    }

    private InputFocus Focus()
    {
        var current = TypingFocusWin32.Read();
        if (current != previousFocus) { locator.Invalidate(); pendingTyping = null; previousFocus = current; }
        return current;
    }
    private void DrainClicks(double now)
    {
        while (clicks.TryDequeue(out var click))
        {
            var visible = Cursor(click.Time, click.Point, true, true, "arrow").Visible;
            var recent = now - click.Time is >= 0 and <= .2;
            var focus = recent
                ? TypingFocusWin32.AtClick(click.Point, visible, sourceWindow, excluded) : default;
            locator.Invalidate(); pendingTyping = null;
            typing.Click(recent ? click.Time : now, focus);
        }
    }
    private void Key(double time, TypingKeyAction action)
    {
        DrainClicks(time);
        var focus = Focus();
        if (action == TypingKeyAction.Reset) { locator.Invalidate(); pendingTyping = null; }
        var position = action == TypingKeyAction.Typing ? locator.Read(time, focus) : null;
        typing.Key(time, action, focus, position);
        if (action == TypingKeyAction.Typing) pendingTyping = position is null ? (time, focus) : null;
    }
    private void Tick(double time)
    {
        DrainClicks(time);
        var focus = Focus(); typing.CheckFocus(time, focus);
        if (pendingTyping is not { } pending) return;
        if (pending.Focus != focus || time - pending.Time > .3) { pendingTyping = null; return; }
        if (locator.Read(time, focus) is not { } position) return;
        typing.Key(time, TypingKeyAction.Typing, focus, position); pendingTyping = null;
    }
    private CursorSample Cursor(double time, Win32.Point point, bool visible, bool click, string shape)
    {
        var bounds = selection.Bounds(); var crop = selection.Crop;
        var x = (point.X - bounds.Left - (crop?.X ?? 0)) / Math.Max(1, crop?.Width ?? bounds.Width);
        var y = (point.Y - bounds.Top - (crop?.Y ?? 0)) / Math.Max(1, crop?.Height ?? bounds.Height);
        var current = TypingFocusWin32.Read();
        return new CursorSample(time, Math.Clamp(x, 0, 1), Math.Clamp(y, 0, 1), visible && bounds.Width > 0 && bounds.Height > 0
            && x is >= 0 and <= 1 && y is >= 0 and <= 1 && !excluded.Contains(current.Foreground), click, shape,
            click ? null : RawInputWin32.PrimaryDown());
    }
    private async Task Sample()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1d / 30));
        try
        {
            do
            {
                if (sourceWindow != 0 && (!Win32.IsWindow(sourceWindow) || Win32.IsIconic(sourceWindow)))
                    throw new InvalidOperationException("直播来源窗口已关闭或最小化，请恢复窗口后重新开始投屏。");
                var events = new List<object>();
                var info = new Win32.CursorInfo { Size = Marshal.SizeOf<Win32.CursorInfo>() };
                var visible = Win32.GetCursorInfo(ref info) && (info.Flags & 1) != 0;
                var shape = info.Handle == hand ? "hand" : info.Handle == ibeam ? "ibeam" : "arrow";
                while (mouse.TryDequeue(out var click))
                {
                    if (!clicks.TryEnqueue(click))
                        keyboard.SetError(new InvalidOperationException("直播点击队列已满，请重新开始投屏。"));
                    events.Add(new { cursor = Cursor(click.Time, click.Point, true, true, shape) });
                }
                events.Add(new { cursor = Cursor(clock.Seconds, info.Position, visible, false, shape) });
                while (activity.TryDequeue(out var value)) events.Add(new { activity = value });
                Protocol.Write(new { @event = "live-input", data = events });
                if (mouse.Error is not null || keyboard.Error is not null)
                    throw new InvalidOperationException("直播输入采集已停止，请重新开始投屏。");
            } while (await timer.WaitForNextTickAsync(stopped.Token));
        }
        catch (OperationCanceledException) { }
        catch (Exception ex) { Protocol.Write(new { @event = "live-error", error = ex.Message }); }
    }
    public async ValueTask DisposeAsync()
    {
        stopped.Cancel(); keyboard.Dispose(); mouse.Dispose(); locator.Dispose();
        if (sampling is not null) await sampling;
        stopped.Dispose();
    }
}
