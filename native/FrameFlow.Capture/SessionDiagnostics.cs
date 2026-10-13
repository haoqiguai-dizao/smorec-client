using System.Text.Json;

namespace FrameFlow.Capture;

internal sealed class SessionDiagnostics
{
    private readonly object gate = new();
    internal string FilePath { get; }
    internal SessionDiagnostics(string directory, string filename = "capture.log") => FilePath = Path.Combine(directory, filename);

    internal void Write(string stage, object? detail = null, Exception? error = null)
    {
        var line = JsonSerializer.Serialize(new
        {
            at = DateTimeOffset.UtcNow, stage, detail,
            error = error?.ToString(), hresult = error is null ? null : $"0x{error.HResult:X8}"
        }, Protocol.Json);
        lock (gate)
        {
            try { File.AppendAllText(FilePath, line + Environment.NewLine); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { Console.Error.WriteLine($"capture.log write failed: {ex.Message}"); }
        }
    }

    internal string Explain(Exception error) => $"{error.Message}。诊断日志：{FilePath}";
}
