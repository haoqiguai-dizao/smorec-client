using System.Text.Json;
using System.Text.Json.Serialization;

namespace FrameFlow.Capture;

internal record CaptureRect(double X, double Y, double Width, double Height);
internal record CaptureSource(string Id, string Kind, string Name, int Width, int Height, CaptureRect? Bounds = null);
internal record RecordingOptions(string SourceId, bool SystemAudio, bool Microphone, int Fps, CaptureRect? Crop,
    string? MicrophoneDeviceId = null, string[]? ExcludeWindowHandles = null, string Resolution = "native",
    string[]? ExcludedApplications = null, bool LiveAudio = false);
internal record MicrophoneDevice(string Id, string Name, bool IsDefault);
internal record AudioMuteOptions(bool? MicrophoneMuted, bool? SystemAudioMuted);
internal record AudioMuteState(bool MicrophoneMuted, bool SystemAudioMuted);
internal record LiveAudioOptions(bool System, bool Microphone);
internal record WhiteboardPresentationOptions(string WindowId, bool Visible);
internal record CursorSample(double T, double X, double Y, bool Visible, bool Click, string Shape, bool? PrimaryDown = null);
internal record InputActivityFocus(double X, double Y);
internal record InputActivitySample(double T, string Kind, InputActivityFocus? Focus = null);
internal record NativeRecordingResult(string Directory, double Duration, int Width, int Height,
    string Video, string Cursor, string? SystemAudio, string? Microphone, double StartedAtUnixMs, string[] Warnings,
    double VideoDuration, double TailHold, string? InputActivity = null);
internal record Command(JsonElement Id, string CommandName, RecordingOptions? Options, string? Directory,
    AudioMuteOptions? AudioMute, string? TrialDeviceId, string? PipeName, string[]? ExcludedApplications, string? DictationId,
    WhiteboardPresentationOptions? Whiteboard = null, LiveAudioOptions? LiveAudio = null, bool? DemoVisible = null);

internal static class Protocol
{
    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    private static readonly object OutputLock = new();

    internal static void Write(object message)
    {
        lock (OutputLock)
        {
            try
            {
                Console.WriteLine(JsonSerializer.Serialize(message, Json));
                Console.Out.Flush();
            }
            catch (IOException) { /* Parent has closed its pipe; native cleanup must still complete. */ }
        }
    }

    internal static Command Parse(string line)
    {
        using var document = JsonDocument.Parse(line);
        var root = document.RootElement;
        var id = root.GetProperty("id").Clone();
        var command = root.GetProperty("command").GetString() ?? "";
        var hasOptions = root.TryGetProperty("options", out var value);
        var options = hasOptions && command is "start" or "live-start" ? value.Deserialize<RecordingOptions>(Json) : null;
        var mute = hasOptions && command == "audio-mute" ? value.Deserialize<AudioMuteOptions>(Json) : null;
        var directory = root.TryGetProperty("directory", out value) ? value.GetString() : null;
        var trialDeviceId = root.TryGetProperty("deviceId", out value) ? value.GetString() : null;
        var pipeName = root.TryGetProperty("pipeName", out value) ? value.GetString() : null;
        var excluded = command is "live-exclusions" or "recording-exclusions" && root.TryGetProperty("excludedApplications", out value)
            ? value.Deserialize<string[]>(Json) : null;
        var dictationId = root.TryGetProperty("dictationId", out value) ? value.GetString() : null;
        WhiteboardPresentationOptions? whiteboard = null;
        if (command is "whiteboard-presentation" or "live-whiteboard")
        {
            if (!root.TryGetProperty("windowId", out var window) || window.ValueKind != JsonValueKind.String
                || !root.TryGetProperty("visible", out var visible) || visible.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                throw new ArgumentException("白板界面采集参数无效。");
            whiteboard = new WhiteboardPresentationOptions(window.GetString()!, visible.GetBoolean());
        }
        LiveAudioOptions? liveAudio = null;
        if (command == "live-audio")
        {
            var audio = root.GetProperty("options");
            liveAudio = new(audio.GetProperty("system").GetBoolean(), audio.GetProperty("microphone").GetBoolean());
        }
        var demoVisible = command is "live-demo" or "recording-demo" ? root.GetProperty("visible").GetBoolean() : (bool?)null;
        return new Command(id, command, options, directory, mute, trialDeviceId, pipeName, excluded, dictationId, whiteboard, liveAudio, demoVisible);
    }

    internal static void State(string status, string? error = null, double? startedAtUnixMs = null,
        string? warning = null, string[]? warnings = null) =>
        Write(new { @event = "state", state = new { status, error, startedAtUnixMs, warning, warnings } });
}
