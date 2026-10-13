namespace FrameFlow.Capture;

internal sealed class StandaloneDictation : IAsyncDisposable
{
    private readonly AudioTrack track;
    private readonly string id;
    private StandaloneDictation(string directory, string? device, string id)
    {
        this.id = id;
        track = new AudioTrack(directory, "microphone", false, new CaptureClock(),
            _ => { }, new SessionDiagnostics(directory), device);
    }
    internal static async Task<StandaloneDictation> StartAsync(string directory, string? device, string id, CancellationToken token)
    {
        Directory.CreateDirectory(directory);
        var session = new StandaloneDictation(directory, device, id);
        try
        {
            session.track.Start();
            await session.track.WaitForFirstPacketAsync(token);
            await session.track.BeginDictationAsync(directory, id, token);
            return session;
        }
        catch { await session.DisposeAsync(); throw; }
    }
    internal object Stop(string clipId) => track.EndDictation(clipId);
    public async ValueTask DisposeAsync()
    {
        track.CancelDictation(id);
        try { await track.StopAsync(); }
        finally { track.Dispose(); }
    }
}
