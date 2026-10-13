using System.Collections.Concurrent;

namespace FrameFlow.Capture;

internal sealed class AudioCaptureGroup : IDisposable
{
    private readonly string directory;
    private readonly CaptureClock clock;
    private readonly SessionDiagnostics log;
    private readonly Action<string> warning;
    private readonly List<AudioTrack> tracks = [];
    private readonly ConcurrentDictionary<string, bool> failedTracks = new();

    internal AudioCaptureGroup(string directory, CaptureClock clock, SessionDiagnostics log, Action<string> warning)
    { this.directory = directory; this.clock = clock; this.log = log; this.warning = warning; }

    internal async Task StartAsync(RecordingOptions options, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (options.SystemAudio) TryStart("system", true);
        if (options.Microphone)
        {
            cancellation.ThrowIfCancellationRequested();
            var microphone = TryStart("microphone", false, options.MicrophoneDeviceId)
                ?? throw new InvalidOperationException("麦克风无法启动，请选择其他输入设备后再开始。");
            // A successful AudioClient.Start does not prove that the endpoint sends
            // data. Silent packets qualify; a missing input must not produce a
            // apparently successful screen recording with its requested mic absent.
            await microphone.WaitForFirstPacketAsync(cancellation);
        }
    }

    private AudioTrack? TryStart(string name, bool loopback, string? deviceId = null)
    {
        AudioTrack? track = null;
        try
        {
            track = new AudioTrack(directory, name, loopback, clock, ex => Failed(name, ex), log, deviceId);
            tracks.Add(track);
            track.Start();
            return track;
        }
        catch (Exception ex)
        {
            track?.Dispose();
            if (!string.IsNullOrWhiteSpace(deviceId))
                throw new InvalidOperationException("无法启动所选麦克风，请检查设备状态和录音权限。", ex);
            Failed(name, ex);
            return null;
        }
    }

    private AudioTrack Microphone => tracks.FirstOrDefault(track => track.Name == "microphone" && !track.Finished)
        ?? throw new InvalidOperationException("本次录制没有可用的麦克风。");
    internal Task BeginDictationAsync(string directory, string id, CancellationToken token) => Microphone.BeginDictationAsync(directory, id, token);
    internal object EndDictation(string id) => Microphone.EndDictation(id);
    internal void CancelDictation(string id) => tracks.FirstOrDefault(track => track.Name == "microphone")?.CancelDictation(id);

    internal AudioMuteState SetMute(AudioMuteOptions options)
    {
        if (options.MicrophoneMuted is null && options.SystemAudioMuted is null)
            throw new ArgumentException("audio-mute 至少需要 microphoneMuted 或 systemAudioMuted。");
        var microphone = tracks.FirstOrDefault(track => track.Name == "microphone");
        var system = tracks.FirstOrDefault(track => track.Name == "system");
        // Validate both updates before applying either, so a failed request is atomic.
        ValidateMuteTarget(microphone, options.MicrophoneMuted, "麦克风");
        ValidateMuteTarget(system, options.SystemAudioMuted, "系统声音");
        if (options.MicrophoneMuted is { } microphoneMuted) microphone!.SetMuted(microphoneMuted);
        if (options.SystemAudioMuted is { } systemMuted) system!.SetMuted(systemMuted);
        var state = new AudioMuteState(microphone?.Muted ?? true, system?.Muted ?? true);
        log.Write("audio-mute", new { state, time = clock.Seconds });
        return state;
    }

    private void ValidateMuteTarget(AudioTrack? track, bool? update, string name)
    {
        if (update is not null && (track is null || track.Finished || failedTracks.ContainsKey(track.Name)))
            throw new InvalidOperationException($"本次录制没有可用的{name}轨道，不能更改静音状态。");
    }

    private void Failed(string name, Exception ex)
    {
        if (!failedTracks.TryAdd(name, true)) return;
        log.Write("audio-disabled", new { track = name }, ex);
        warning($"{(name == "system" ? "系统声音" : "麦克风")}未能完整录制，视频会继续保存。{ex.Message}");
    }

    internal async Task StopAsync()
    {
        await Task.WhenAll(tracks.Select(async track =>
        {
            try { await track.StopAsync(); }
            catch (Exception ex) { Failed(track.Name, ex); }
            finally { track.Dispose(); }
        }));
    }

    internal string? FinalizeTrack(string name, double origin, double duration)
    {
        var track = tracks.FirstOrDefault(item => item.Name == name);
        if (track is null || failedTracks.ContainsKey(name) || !track.Finished) return null;
        if (!track.HasPackets && name == "microphone")
        {
            Failed(name, new IOException("未收到麦克风数据，请检查 Windows 麦克风权限和默认输入设备。"));
            return null;
        }
        try
        {
            AudioTrack.Align(directory, name, origin, duration);
            return name + ".wav";
        }
        catch (Exception ex) { Failed(name, ex); return null; }
    }

    public void Dispose()
    {
        foreach (var track in tracks) track.Dispose();
    }
}
