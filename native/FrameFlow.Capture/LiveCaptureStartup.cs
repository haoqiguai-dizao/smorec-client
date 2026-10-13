using System.ComponentModel;

namespace FrameFlow.Capture;

internal sealed class LiveCaptureBackendException(string message) : Exception(message);

internal static class LiveCaptureStartup
{
    internal static async ValueTask CleanupAsync(params Func<ValueTask>[] resources)
    {
        var errors = new List<Exception>();
        foreach (var release in resources)
        {
            try { await release(); }
            catch (Exception error) { errors.Add(error); }
        }
        if (errors.Count != 0) throw new AggregateException("直播采集资源清理未完成。", errors);
    }

    internal static bool IsExclusionHandleError(Exception error)
    {
        if (error is ArgumentException && error.Message == "录制悬浮窗已关闭，请重新开始录制。") return true;
        if (error is not LiveCaptureBackendException) return false;
        // The capture library exposes its HRESULT only as a localized FormatMessage string.
        // Match complete system messages, never a broad "capture failed" substring.
        return new[] { 6, 87, 1400 }.Any(code =>
            error.Message.TrimEnd().EndsWith(new Win32Exception(code).Message.TrimEnd(), StringComparison.Ordinal));
    }

    internal static async Task<T> RunAsync<T>(RecordingOptions options, LiveExcludedWindow[] snapshot,
        Func<LiveExcludedWindow, bool> isCurrent, Func<nint, bool> isWindow,
        Func<RecordingOptions, T> create, Func<T, CancellationToken, Task> start, CancellationToken token)
        where T : class, IAsyncDisposable
    {
        for (var attempt = 0; ; attempt++)
        {
            token.ThrowIfCancellationRequested();
            var current = LiveWindowExclusions.Current(snapshot, isCurrent);
            var merged = LiveWindowExclusions.Merge(options, current);
            T? session = null;
            try
            {
                session = create(merged);
                await start(session, token);
                return session;
            }
            catch (Exception error)
            {
                // Always release the failed pipe/session before a retry reuses its pipe name.
                if (session is not null)
                {
                    try { await session.DisposeAsync(); }
                    catch (Exception cleanupError)
                    { throw new AggregateException("直播启动失败，且资源清理未完成。", error, cleanupError); }
                }
                if (attempt != 0 || token.IsCancellationRequested || !IsExclusionHandleError(error)
                    || !current.Any(window => !isCurrent(window))
                    || !LiveWindowExclusions.OwnWindowsValid(options, isWindow)) throw;
                // Retry only the original snapshot, never silently enroll newly created windows.
                snapshot = LiveWindowExclusions.Current(current, isCurrent);
            }
        }
    }
}

// Startup failures belong to the live-start request. Only active-session failures are broadcast.
internal sealed class LiveCaptureStartupSignal(Action<Exception> activeFailure)
{
    private readonly object gate = new();
    private readonly TaskCompletionSource<Exception> failure = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private bool active, closed;

    internal void Fail(Exception error)
    {
        lock (gate)
        {
            if (closed) return;
            if (!active) failure.TrySetResult(error);
            else activeFailure(error);
        }
    }

    internal async Task WaitForFrameAsync(Task firstFrame, CancellationToken token)
    {
        try { await Task.WhenAny(firstFrame, failure.Task).WaitAsync(TimeSpan.FromSeconds(12), token); }
        catch (TimeoutException) { throw new LiveCaptureBackendException("画面准备超时。请确认所选窗口可见，或更换画面来源后重试。"); }
        if (failure.Task.IsCompleted) throw await failure.Task;
        await firstFrame;
    }

    internal void Activate()
    {
        lock (gate)
        {
            if (failure.Task.IsCompleted) throw failure.Task.Result;
            active = true;
        }
    }

    internal void Close() { lock (gate) closed = true; }
}
