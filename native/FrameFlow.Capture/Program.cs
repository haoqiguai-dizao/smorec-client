using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using FrameFlow.Capture;

Console.InputEncoding = new UTF8Encoding(false);
Console.OutputEncoding = new UTF8Encoding(false);
Win32.SetProcessDpiAwarenessContext((nint)(-4));
if (args is ["--whiteboard-track"])
{
    Environment.ExitCode = await WhiteboardTrackProcess.RunAsync();
    return;
}
RecordingSession? session = null;
MicrophoneTrial? trial = null;
LiveCaptureSession? live = null;
StandaloneDictation? dictation = null;
using var parentClosed = new CancellationTokenSource();
var input = Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true, SingleWriter = true });
_ = Task.Run(async () =>
{
    try
    {
        while (await Console.In.ReadLineAsync() is { } line) await input.Writer.WriteAsync(line);
    }
    catch (Exception ex) when (ex is IOException or ObjectDisposedException) { }
    finally { parentClosed.Cancel(); input.Writer.TryComplete(); }
});
Console.CancelKeyPress += (_, args) =>
{
    args.Cancel = true;
    parentClosed.Cancel();
    Console.In.Close();
};

try
{
    await foreach (var line in input.Reader.ReadAllAsync())
    {
        if (string.IsNullOrWhiteSpace(line)) continue;
        Command? request = null;
        try
        {
            request = Protocol.Parse(line);
            object data;
            switch (request.CommandName)
            {
                case "sources":
                    data = SourceCatalog.List();
                    break;
                case "live-applications":
                    data = WindowsApplicationCatalog.Capture().Applications;
                    break;
                case "microphone-devices":
                    data = MicrophoneCatalog.List();
                    break;
                case "start":
                    if (live is not null) throw new InvalidOperationException("请先结束直播投屏。");
                    if (trial is not null) throw new InvalidOperationException("请先结束麦克风试录。");
                    if (session is not null) throw new InvalidOperationException("已经存在录制，请先停止。");
                    if (request.Options is null || string.IsNullOrWhiteSpace(request.Directory))
                        throw new ArgumentException("start 需要 options 和 directory。");
                    session = await RecordingSession.StartAsync(request.Directory, request.Options, parentClosed.Token);
                    data = new { startedAtUnixMs = session.StartedAtUnixMs, warnings = session.Warnings };
                    break;
                case "recording-dictation-start":
                    if (session is null || request.Directory is null || request.DictationId is null)
                        throw new ArgumentException("语音录入参数或录制会话无效。");
                    await session.BeginDictationAsync(request.Directory, request.DictationId, parentClosed.Token);
                    data = new { ready = true };
                    break;
                case "recording-dictation-stop":
                    if (session is null || request.DictationId is null) throw new ArgumentException("语音片段已结束。");
                    data = session.EndDictation(request.DictationId);
                    break;
                case "recording-dictation-cancel":
                    if (request.DictationId is not null) session?.CancelDictation(request.DictationId);
                    data = new { cancelled = true };
                    break;
                case "dictation-start":
                    if (session is not null || trial is not null || live is not null || dictation is not null)
                        throw new InvalidOperationException("请先结束当前采集。");
                    if (request.Directory is null || request.DictationId is null) throw new ArgumentException("语音录入参数无效。");
                    dictation = await StandaloneDictation.StartAsync(request.Directory, request.TrialDeviceId, request.DictationId, parentClosed.Token);
                    data = new { ready = true };
                    break;
                case "dictation-stop":
                    if (dictation is null || request.DictationId is null) throw new InvalidOperationException("语音片段已结束。");
                    try { data = dictation.Stop(request.DictationId); }
                    finally { await dictation.DisposeAsync(); dictation = null; }
                    break;
                case "audio-mute":
                    if (session is null) throw new InvalidOperationException("当前没有正在录制的工程。");
                    if (request.AudioMute is null) throw new ArgumentException("audio-mute 需要 options。");
                    data = await session.SetAudioMuteAsync(request.AudioMute);
                    break;
                case "whiteboard-presentation":
                    if (session is null || request.Whiteboard is null)
                        throw new ArgumentException("白板界面采集需要正在录制的会话。");
                    await session.SetWhiteboardPresentationAsync(request.Whiteboard, parentClosed.Token);
                    data = new { applied = true };
                    break;
                case "stop":
                    if (session is null) throw new InvalidOperationException("当前没有正在录制的工程。");
                    try { data = await session.StopAsync(); }
                    finally { await session.DisposeAsync(); session = null; }
                    break;
                case "recording-exclusions":
                    if (session is null || request.ExcludedApplications is null)
                        throw new ArgumentException("排除应用更新参数或录制会话无效。");
                    await session.SetExcludedApplicationsAsync(request.ExcludedApplications, parentClosed.Token);
                    data = new { applied = true };
                    break;
                case "microphone-trial-start":
                    if (live is not null) throw new InvalidOperationException("请先结束直播投屏。");
                    if (session is not null || trial is not null) throw new InvalidOperationException("请先结束当前录制。");
                    if (string.IsNullOrWhiteSpace(request.Directory)) throw new ArgumentException("试录目录无效。");
                    trial = await MicrophoneTrial.StartAsync(request.Directory, request.TrialDeviceId, parentClosed.Token);
                    data = new { ready = true };
                    break;
                case "microphone-trial-stop":
                    if (trial is null) throw new InvalidOperationException("麦克风试录已结束。");
                    try { data = await trial.StopAsync(); }
                    finally { await trial.DisposeAsync(); trial = null; }
                    break;
                case "live-start":
                    if (session is not null || trial is not null || live is not null)
                        throw new InvalidOperationException("请先结束当前采集。");
                    if (request.Options is null || request.PipeName is null) throw new ArgumentException("直播采集参数无效。");
                    live = await LiveCaptureSession.StartAsync(request.Options, request.PipeName, parentClosed.Token);
                    data = new { width = live.Width, height = live.Height, startedAtUnixMs = live.StartedAtUnixMs };
                    break;
                case "live-exclusions":
                    if (live is null || request.ExcludedApplications is null)
                        throw new ArgumentException("排除应用更新参数或投屏会话无效。");
                    await live.SetExcludedApplicationsAsync(request.ExcludedApplications, parentClosed.Token);
                    data = new { applied = true };
                    break;
                case "live-audio":
                    if (live is null || request.LiveAudio is null) throw new ArgumentException("直播声音参数无效。");
                    data = await live.SetAudioAsync(request.LiveAudio, parentClosed.Token);
                    break;
                case "live-whiteboard":
                    if (live is null || request.Whiteboard is null) throw new ArgumentException("白板直播参数无效。");
                    await live.SetWhiteboardAsync(request.Whiteboard, parentClosed.Token);
                    data = new { ready = true };
                    break;
                case "live-demo":
                    if (live is null || request.DemoVisible is null) throw new ArgumentException("演示直播参数无效。");
                    await live.SetDemoVisibleAsync(request.DemoVisible.Value, parentClosed.Token);
                    data = new { applied = true };
                    break;
                case "recording-demo":
                    if (session is null || request.DemoVisible is null) throw new ArgumentException("演示录制参数无效。");
                    data = new { time = await session.SetDemoVisibleAsync(request.DemoVisible.Value, parentClosed.Token) };
                    break;
                case "live-stop":
                    if (live is not null) { await live.DisposeAsync(); live = null; }
                    data = new { stopped = true };
                    break;
                default:
                    throw new ArgumentException("未知命令。支持 sources、microphone-devices、start、audio-mute、stop。");
            }
            Protocol.Write(new { id = request.Id, ok = true, data });
        }
        catch (Exception ex)
        {
            // Keep stdout strictly JSON Lines; diagnostics never contaminate the transport.
            Protocol.Write(new { id = request?.Id ?? JsonSerializer.SerializeToElement<object?>(null), ok = false, error = ex.Message });
        }
    }
}
finally
{
    if (dictation is not null) await dictation.DisposeAsync();
    if (session is not null) await session.DisposeAsync();
    if (trial is not null) await trial.DisposeAsync();
    if (live is not null) await live.DisposeAsync();
}
