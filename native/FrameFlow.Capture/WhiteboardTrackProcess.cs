using System.Text.Json;

namespace FrameFlow.Capture;

// Private stdin protocol: only the recording helper starts this process, never the renderer.
internal static class WhiteboardTrackProcess
{
    internal sealed record StartRequest(string Directory, string WindowId, double ScreenOriginQpcSeconds);

    internal static async Task<int> RunAsync()
    {
        WhiteboardVideoSession? session = null;
        try
        {
            var line = await Console.In.ReadLineAsync() ?? throw new ArgumentException("白板采集参数缺失。");
            if (line.Length > 4096) throw new ArgumentException("白板采集参数过长。");
            var request = JsonSerializer.Deserialize<StartRequest>(line, Protocol.Json)
                ?? throw new ArgumentException("白板采集参数无效。");
            if (!Path.IsPathFullyQualified(request.Directory) || !Directory.Exists(request.Directory)
                || !double.IsFinite(request.ScreenOriginQpcSeconds) || request.ScreenOriginQpcSeconds <= 0)
                throw new ArgumentException("白板工程目录或时钟无效。");
            var fatal = new TaskCompletionSource<Exception>(TaskCreationOptions.RunContinuationsAsynchronously);
            session = new WhiteboardVideoSession(request.Directory,
                message => Protocol.Write(new { type = "warning", message }), error => fatal.TrySetResult(error));
            await session.StartAsync(request.WindowId, request.ScreenOriginQpcSeconds);
            Protocol.Write(new { type = "ready" });
            // EOF also finalizes media when the owning recording process disappears.
            var stop = Console.In.ReadLineAsync();
            if (await Task.WhenAny(stop, fatal.Task) == fatal.Task) throw await fatal.Task;
            await stop;
            await session.StopAsync(); session = null;
            Protocol.Write(new { type = "finished" });
            return 0;
        }
        catch (Exception error)
        {
            Protocol.Write(new { type = "error", message = error.Message });
            return 1;
        }
        finally
        {
            if (session is not null)
            {
                try { await session.StopAsync(); }
                catch (Exception error) { Console.Error.WriteLine(error.Message); }
            }
        }
    }
}
