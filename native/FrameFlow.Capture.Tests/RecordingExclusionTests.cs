using System.Text.Json;
using FrameFlow.Capture;

internal static class RecordingExclusionTests
{
    internal static void Run(Action<bool, string> check)
    {
        var clear = Protocol.Parse("""{"id":1,"command":"recording-exclusions","excludedApplications":[]}""");
        check(clear.ExcludedApplications is { Length: 0 } && clear.Options is null,
            "recording exclusions accepts an explicit empty selection independently of start options");
        var update = Protocol.Parse("""{"id":2,"command":"recording-exclusions","excludedApplications":["C:\\Fixtures\\Helper.exe"]}""");
        check(update.ExcludedApplications is ["C:\\Fixtures\\Helper.exe"], "recording exclusions preserves exact application identity");
        check(Protocol.Parse("""{"id":3,"command":"recording-exclusions"}""").ExcludedApplications is null,
            "missing recording exclusion selection remains invalid instead of clearing the list");
        var rejected = false;
        try { Protocol.Parse("""{"id":4,"command":"recording-exclusions","excludedApplications":"Helper.exe"}"""); }
        catch (JsonException) { rejected = true; }
        check(rejected, "recording exclusions rejects a malformed selection before capture");
    }
}
