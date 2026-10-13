using System.Text.Json;
using FrameFlow.Capture;

internal static class TypingFocusPositionTests
{
    internal static void Run(Action<bool, string> check)
    {
        var first = new InputFocus(1, 11);
        var second = new InputFocus(1, 12);
        var focus = new InputActivityFocus(.35, .4);
        var other = new InputActivityFocus(.7, .65);
        var samples = new List<InputActivitySample>();
        var state = new TypingActivityState(samples.Add);
        state.Key(1, TypingKeyAction.Typing, first, focus);
        check(samples.SequenceEqual([new InputActivitySample(1, "typing", focus)]),
            "verified input geometry establishes an autofocus shot without a preceding click");
        state.Key(1.02, TypingKeyAction.Typing, first, focus);
        check(samples.Count == 1, "focused input keeps the existing ten-per-second throttle");
        state.Key(2, TypingKeyAction.Reset, first);
        state.Key(2.2, TypingKeyAction.Typing, second, other);
        check(samples[^1] == new InputActivitySample(2.2, "typing", other),
            "verified geometry restores typing after Tab without requiring another mouse click");
        state.Key(2.4, TypingKeyAction.Typing, second);
        check(samples[^1] == new InputActivitySample(2.4, "typing"),
            "a temporary geometry failure can retain the same verified native focus");
        state.CheckFocus(3, first);
        state.Key(3.1, TypingKeyAction.Typing, first, focus);
        check(samples[^2] == new InputActivitySample(3, "reset")
            && samples[^1] == new InputActivitySample(3.1, "typing", focus),
            "native focus transitions publish their reset before the new position establishes an anchor");
        state.Key(4, TypingKeyAction.Reset, first);
        var count = samples.Count;
        state.Key(3.9, TypingKeyAction.Typing, first, focus);
        state.Key(4.1, TypingKeyAction.Typing, default, focus);
        state.Key(4.2, TypingKeyAction.Typing, first, new InputActivityFocus(double.NaN, .5));
        check(samples.Count == count, "stale, absent and invalid focus locations cannot restore a cleared anchor");
        var bounds = new Win32.Rect { Left = -1920, Top = 120, Right = 0, Bottom = 1200 };
        check(TypingFocusGeometry.Normalize(-960, 660, bounds, null) == new InputActivityFocus(.5, .5),
            "physical focus coordinates normalize on a monitor with a negative origin");
        var crop = new CaptureRect(100, 50, 800, 400);
        check(TypingFocusGeometry.Normalize(-1420, 370, bounds, crop) == new InputActivityFocus(.5, .5),
            "focus positions use source and crop coordinates independently of encoded output resolution");
        check(TypingFocusGeometry.Normalize(-1900, 130, bounds, crop) is null
            && TypingFocusGeometry.Normalize(double.PositiveInfinity, 370, bounds, crop) is null
            && TypingFocusGeometry.Normalize(0, 0, default, null) is null,
            "outside recording regions, nonfinite positions and unavailable windows cannot become focus");
        check(TypingFocusGeometry.EditorCenter([-1800, 200, 400, 40], bounds, null)
            == TypingFocusGeometry.Normalize(-1600, 220, bounds, null),
            "a focused editor rectangle uses its physical center without reading its content");
        check(TypingFocusGeometry.EditorCenter([-1920, 120, 1920, 1080], bounds, null) is null
            && TypingFocusGeometry.EditorCenter([0, 0, -1, 100], bounds, null) is null,
            "whole-document and malformed UIA rectangles are conservatively rejected");
        using var schema = JsonDocument.Parse(JsonSerializer.Serialize(new InputActivitySample(1, "typing", focus), Protocol.Json));
        check(schema.RootElement.EnumerateObject().Select(value => value.Name).SequenceEqual(["t", "kind", "focus"])
            && schema.RootElement.GetProperty("focus").EnumerateObject().Select(value => value.Name).SequenceEqual(["x", "y"]),
            "focused activity persists only normalized x/y, timestamp and category");
    }

    internal static async Task CheckJournalAsync(Action<bool, string> check)
    {
        var directory = Path.Combine(Path.GetTempPath(), "FrameFlow.Focus.Tests." + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var focus = new InputActivityFocus(.3, .7);
        try
        {
            using (var journal = new InputActivityJournal(directory))
            {
                journal.Write(new(2, "typing", focus));
                journal.Write(new(3, "reset", focus));
                journal.Write(new(3, "typing", new InputActivityFocus(-1, .5)));
                journal.Write(new(4, "reset"));
                await journal.FlushAsync();
            }
            await InputActivityJournal.FinalizeAsync(directory, 1, 4);
            var restored = JsonSerializer.Deserialize<InputActivitySample[]>(
                File.ReadAllText(Path.Combine(directory, "input-activity.json")), Protocol.Json);
            check(restored is not null && restored.SequenceEqual([
                new InputActivitySample(1, "typing", focus), new InputActivitySample(3, "reset")]),
                "focused journal round-trip preserves position and video-clock alignment, rejecting invalid positions");
            foreach (var corrupt in new[]
            {
                "{\"t\":1,\"kind\":\"reset\",\"focus\":{\"x\":0.5,\"y\":0.5}}",
                "{\"t\":1,\"kind\":\"typing\",\"focus\":{\"x\":0.5,\"y\":0.5,\"text\":\"synthetic\"}}"
            })
            {
                await File.WriteAllTextAsync(Path.Combine(directory, "input-activity.recovery.jsonl"), corrupt);
                try
                {
                    await InputActivityJournal.FinalizeAsync(directory, 0, 4);
                    throw new InvalidOperationException("Malformed focus was accepted.");
                }
                catch (Exception ex) when (ex is JsonException or InvalidDataException)
                {
                    check(true, "malformed native focus journals fail closed instead of skipping a possible reset");
                }
            }
        }
        finally
        {
            File.Delete(Path.Combine(directory, "input-activity.recovery.jsonl"));
            File.Delete(Path.Combine(directory, "input-activity.json"));
            Directory.Delete(directory);
        }
    }
}
