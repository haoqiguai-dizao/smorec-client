using System.Diagnostics;
using System.Text.Json;

namespace FrameFlow.Capture;

// The window engine is process-global. Keep the second WGC window in its own
// owned helper so recording a window and the board cannot corrupt each other.
internal sealed class WhiteboardCapture
{
    private readonly string directory;
    private readonly CaptureClock clock;
    private readonly SessionDiagnostics log;
    private readonly Action<string> warning;
    private readonly Action<Exception> failed;
    private Process? process;
    private nint window;
    private Task? monitor;
    private Task? stopping;
    private volatile bool stopRequested;
    private volatile bool ready;

    internal WhiteboardCapture(string directory, CaptureClock clock, SessionDiagnostics log,
        Action<string> warning, Action<Exception> failed)
    {
        this.directory = directory; this.clock = clock; this.log = log;
        this.warning = warning; this.failed = failed;
    }

    internal async Task ApplyAsync(WhiteboardPresentationOptions options, double screenOrigin, CancellationToken token)
    {
        var handle = WhiteboardVideoSession.ValidateWindow(options.WindowId);
        if (process is not null)
        {
            if (handle != window) throw new ArgumentException("白板采集窗口不能在同一录制中替换。");
            if (process.HasExited) throw new InvalidOperationException("白板界面采集已结束。");
            return; // Continuous media clock; layout events determine visible mode cuts.
        }
        if (!options.Visible) return;
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("白板采集程序路径无效。");
        var child = new Process { StartInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
        } };
        child.StartInfo.ArgumentList.Add("--whiteboard-track");
        child.Start(); process = child; window = handle; stopRequested = false; ready = false; stopping = null;
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        monitor = MonitorAsync(child, started);
        try
        {
            var request = new WhiteboardTrackProcess.StartRequest(directory, options.WindowId, clock.ToQpcSeconds(screenOrigin));
            await child.StandardInput.WriteLineAsync(JsonSerializer.Serialize(request, Protocol.Json));
            await child.StandardInput.FlushAsync(token);
            await started.Task.WaitAsync(TimeSpan.FromSeconds(35), token);
            log.Write("whiteboard-process-ready", new { child.Id });
        }
        catch
        {
            await StopAsync();
            foreach (var filename in new[] { "whiteboard-capture.mp4", "whiteboard-frames.jsonl", "whiteboard-video.tmp", "whiteboard-video.json" })
                File.Delete(Path.Combine(directory, filename));
            throw;
        }
    }

    private async Task MonitorAsync(Process child, TaskCompletionSource started)
    {
        var stderr = child.StandardError.ReadToEndAsync();
        try
        {
            while (await child.StandardOutput.ReadLineAsync() is { } line)
            {
                using var message = JsonDocument.Parse(line);
                var type = message.RootElement.GetProperty("type").GetString();
                if (type == "ready") { ready = true; started.TrySetResult(); }
                else if (type == "warning") warning(message.RootElement.GetProperty("message").GetString()!);
                else if (type == "error") throw new InvalidOperationException(message.RootElement.GetProperty("message").GetString());
            }
            await child.WaitForExitAsync();
            if (!stopRequested || child.ExitCode != 0)
                throw new InvalidOperationException($"白板界面采集意外结束（{child.ExitCode}）。");
        }
        catch (Exception error)
        {
            started.TrySetException(error);
            log.Write("whiteboard-process-failed", error: error);
            if (ready && !stopRequested) failed(error);
            else if (ready && stopRequested) warning("白板界面采集结束异常，已保留恢复文件。");
        }
        finally
        {
            started.TrySetException(new InvalidOperationException("白板界面采集未能就绪。"));
            var detail = await stderr;
            if (!string.IsNullOrWhiteSpace(detail)) log.Write("whiteboard-process-stderr", new { message = detail[..Math.Min(detail.Length, 1024)] });
        }
    }

    internal Task StopAsync() => stopping ??= StopCoreAsync();

    private async Task StopCoreAsync()
    {
        var child = process;
        if (child is null) return;
        stopRequested = true;
        try
        {
            try { await child.StandardInput.WriteLineAsync("stop"); child.StandardInput.Close(); }
            catch (IOException) { }
            try { await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(25)); }
            catch (TimeoutException)
            {
                log.Write("whiteboard-process-stop-timeout");
                child.Kill(); await child.WaitForExitAsync();
            }
            if (monitor is not null) await monitor;
        }
        finally { child.Dispose(); process = null; }
    }
}
