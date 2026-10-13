using System.Text.Json;
using FrameFlow.Capture;

var passed = 0;
void Check(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
    passed++;
    Console.WriteLine("PASS " + name);
}

if (args.Contains("--live-exclusions"))
{
    await LiveWindowExclusionsTests.RunAsync(Check);
    Console.WriteLine($"{passed} live exclusion checks passed; only synthetic snapshots and startup tasks were used.");
    return;
}

if (args.Contains("--typing-focus-native"))
{
    TypingFocusNativeTests.Run(Check);
    Console.WriteLine($"{passed} controlled focus checks passed; only owned fixture geometry and synthetic activity were used.");
    return;
}

if (args.Contains("--recording-exclusion-input"))
{
    RecordingExclusionInputTests.Run(Check);
    Console.WriteLine($"{passed} recording input exclusion checks passed; only non-activating owned windows were used.");
    return;
}

if (args.Contains("--mouse-lifecycle"))
{
    MouseInputLifecycleTests.Run(Check);
    Console.WriteLine($"{passed} mouse lifecycle checks passed; no capture, sensors or input injection were used.");
    return;
}

if (args.Contains("--typing-lifecycle"))
{
    TypingInputLifecycleTests.Run(Check);
    Console.WriteLine($"{passed} typing lifecycle checks passed; no capture, sensors, journal or input injection were used.");
    return;
}

var gate = new AudioMuteGate();
var boardRequest = Protocol.Parse("{\"id\":1,\"command\":\"whiteboard-presentation\",\"windowId\":\"9007199254740993\",\"visible\":true}");
Check(boardRequest.Whiteboard is { WindowId: "9007199254740993", Visible: true }, "whiteboard HWND preserves 64-bit decimal identity");
foreach (var invalidBoard in new[] {
    "{\"id\":1,\"command\":\"whiteboard-presentation\",\"windowId\":42,\"visible\":true}",
    "{\"id\":1,\"command\":\"whiteboard-presentation\",\"windowId\":\"42\",\"visible\":\"true\"}" })
{
    var rejected = false;
    try { Protocol.Parse(invalidBoard); } catch (ArgumentException) { rejected = true; }
    Check(rejected, "whiteboard rejects lossy HWND and non-boolean visibility");
}
LivePcmMixerTests.Run(Check);
RecordingExclusionTests.Run(Check);
var payload = Enumerable.Range(1, 16).Select(value => (byte)value).ToArray();
var original = payload.ToArray();
gate.Apply(payload, 0, payload.Length);
Check(payload.SequenceEqual(original), "unmuted PCM is unchanged");
gate.Set(true);
gate.Apply(payload, 4, 8);
Check(payload.Take(4).SequenceEqual(original.Take(4)) && payload.Skip(12).SequenceEqual(original.Skip(12)),
    "muting touches only the written packet range");
Check(payload.Skip(4).Take(8).All(value => value == 0) && payload.Length == original.Length,
    "muted PCM has the same byte count and silent payload");

using var stream = new MemoryStream();
foreach (var muted in new[] { false, true, false })
{
    gate.Set(muted);
    var packet = original.ToArray();
    gate.Apply(packet, 0, packet.Length);
    stream.Write(packet);
}
var written = stream.ToArray();
Check(written.Length == original.Length * 3, "mute and unmute never remove samples");
Check(written.Take(16).SequenceEqual(original) && written.Skip(16).Take(16).All(value => value == 0)
    && written.Skip(32).SequenceEqual(original), "unmute restores subsequent audio without losing its position");
await Task.Run(() => gate.Set(true));
Check(gate.Muted, "control state is visible across capture threads");

var devices = Protocol.Parse("""{"id":1,"command":"microphone-devices"}""");
Check(devices.CommandName == "microphone-devices" && devices.Options is null, "device enumeration needs no capture options");
var start = Protocol.Parse("""{"id":2,"command":"start","directory":"test","options":{"sourceId":"window:1","fps":30,"microphone":true,"systemAudio":false,"microphoneDeviceId":"endpoint-id"}}""");
Check(start.Options?.MicrophoneDeviceId == "endpoint-id", "explicit endpoint selection survives transport");
var legacyStart = Protocol.Parse("""{"id":3,"command":"start","options":{"sourceId":"window:1","fps":30,"microphone":true,"systemAudio":false}}""");
Check(legacyStart.Options?.MicrophoneDeviceId is null, "legacy start keeps default endpoint behavior");
var exclusion = Protocol.Parse("""{"id":7,"command":"start","options":{"sourceId":"screen:DISPLAY1","fps":30,"excludeWindowHandles":["9007199254740993","42"]}}""");
Check(exclusion.Options?.ExcludeWindowHandles is ["9007199254740993", "42"],
    "HWND decimal strings preserve their values without JavaScript number conversion");
var mute = Protocol.Parse("""{"id":4,"command":"audio-mute","options":{"microphoneMuted":false}}""");
Check(mute.AudioMute is { MicrophoneMuted: false, SystemAudioMuted: null } && mute.Options is null,
    "partial mute updates preserve omitted controls and explicit false");
var both = Protocol.Parse("""{"id":5,"command":"audio-mute","options":{"microphoneMuted":true,"systemAudioMuted":false}}""");
Check(both.AudioMute is { MicrophoneMuted: true, SystemAudioMuted: false }, "both independent mute fields parse correctly");
try
{
    Protocol.Parse("""{"id":6,"command":"audio-mute","options":{"microphoneMuted":"false"}}""");
    throw new InvalidOperationException("string mute state was accepted");
}
catch (JsonException) { Check(true, "invalid mute types are rejected"); }
await LiveWindowExclusionsTests.RunAsync(Check);
AudioPacketPlannerTests.Run(Check);
InputLatencyDiagnosticsTests.Run(Check);
CaptureSpecificationTests.Run(Check);
VideoClockCorrelationTests.Run(Check);
RawMousePacketTests.Run(Check);
TypingActivityTests.Run(Check);
TypingFocusPositionTests.Run(Check);
await TypingFocusPositionTests.CheckJournalAsync(Check);
await TypingActivityTests.CheckJournalAsync(Check);
await TypingFocusRaceTests.RunAsync(Check);
await DictationTapTests.RunAsync(Check);
Console.WriteLine($"{passed} checks passed; no capture or device activation was performed.");
