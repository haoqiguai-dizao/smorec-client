namespace FrameFlow.Capture;

internal sealed class LiveAudioCapture : IAsyncDisposable
{
    private readonly CaptureClock clock;
    private readonly LiveAudioTrack?[] tracks = new LiveAudioTrack?[2];
    private readonly Action<Exception> failed;
    private readonly string? microphoneDeviceId;
    internal LivePcmMixer Mixer { get; }
    internal LiveAudioCapture(RecordingOptions options, CaptureClock clock, Action<Exception> failed)
    {
        this.clock = clock; this.failed = failed; microphoneDeviceId = options.MicrophoneDeviceId;
        Mixer = new(false, false);
    }

    internal async Task StartAsync(RecordingOptions options, CancellationToken token)
    {
        await SetEnabledAsync(options.SystemAudio, options.Microphone, token);
    }
    internal async Task<LiveAudioOptions> SetEnabledAsync(bool system, bool microphone, CancellationToken token)
    {
        bool[] next = [system, microphone];
        var opened = new List<int>();
        try
        {
            for (var channel = 0; channel < 2; channel++)
            {
                token.ThrowIfCancellationRequested();
                if (!next[channel] || tracks[channel] is not null) continue;
                tracks[channel] = StartDevice(channel == 0, channel == 1 ? microphoneDeviceId : null);
                opened.Add(channel);
                if (channel == 1) await tracks[channel]!.WaitForFirstPacketAsync(token);
            }
        }
        catch
        {
            foreach (var channel in opened) { var track = tracks[channel]; tracks[channel] = null; await track!.StopAsync(); }
            throw;
        }
        Mixer.SetEnabled(system, microphone);
        for (var channel = 0; channel < 2; channel++)
            if (!next[channel] && tracks[channel] is { } track)
            {
                tracks[channel] = null;
                // The channel is already silent. A stuck driver must not undo that acknowledgement.
                try { await track.StopAsync(); }
                catch (Exception error) { Console.Error.WriteLine("静音设备释放延迟：" + error.Message); }
            }
        return new(system, microphone);
    }
    private LiveAudioTrack StartDevice(bool loopback, string? id)
    {
        var channel = loopback ? 0 : 1;
        LiveAudioTrack? track = null;
        track = new LiveAudioTrack(loopback, id, clock,
            (samples, count, time) => { if (ReferenceEquals(tracks[channel], track)) Mixer.Push(channel, samples, count, time); },
            error => { if (ReferenceEquals(tracks[channel], track) && Mixer.IsEnabled(channel)) failed(error); });
        track.Start(); return track;
    }
    internal LiveAudioPacket Pull()
    {
        var now = clock.Seconds;
        if (Mixer.IsEnabled(1) && tracks[1] is { } microphone && now - microphone.LastPacket > 3)
            throw new IOException("直播麦克风停止更新，请检查设备后重新开始。");
        return Mixer.Pull(now);
    }
    public async ValueTask DisposeAsync()
    {
        Mixer.SetEnabled(false, false);
        await Task.WhenAll(tracks.OfType<LiveAudioTrack>().Select(track => track.StopAsync()));
    }
}
