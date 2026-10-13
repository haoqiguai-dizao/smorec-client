using System.Text.Json;
using FrameFlow.Capture;

internal static class TypingFocusRaceTests
{
    internal static async Task RunAsync(Action<bool, string> check)
    {
        var samples = new List<InputActivitySample>();
        var state = new TypingActivityState(samples.Add);
        var a = new InputFocus(10, 11);
        var b = new InputFocus(20, 21);
        state.Click(.1, a);
        state.Key(.98, TypingKeyAction.Typing, a);
        state.CheckFocus(1.006, b);
        state.Key(1.01, TypingKeyAction.Typing, b);
        check(samples.Count == 2, "focus change clears the native anchor immediately, before its reset reaches the writer");
        state.Click(1, b);
        state.Key(1.04, TypingKeyAction.Typing, b);
        state.Key(1.08, TypingKeyAction.Typing, b);
        state.Key(1.15, TypingKeyAction.Typing, b);
        state.Key(2, TypingKeyAction.Typing, b);
        state.Key(3, TypingKeyAction.Typing, b);
        state.FlushFocusReset(double.PositiveInfinity);
        using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "typing-focus-click-race.json")));
        var expected = fixture.RootElement.GetProperty("inputActivity").Deserialize<InputActivitySample[]>(Protocol.Json)!;
        check(samples.SequenceEqual(expected), "an older trusted click replaces its delayed same-target focus reset without clearing the new timeline anchor");
        check(samples.Any(sample => sample == new InputActivitySample(1.04, "typing")),
            "the new target keeps its first key within 100 ms of the previous target's last key");

        var explicitSamples = new List<InputActivitySample>();
        var explicitState = new TypingActivityState(explicitSamples.Add);
        explicitState.Click(.1, a);
        explicitState.CheckFocus(1.006, b);
        explicitState.Key(1.01, TypingKeyAction.Reset, b);
        explicitState.Click(1, b);
        explicitState.Key(1.04, TypingKeyAction.Typing, b);
        check(explicitSamples.All(sample => sample.Kind != "typing"),
            "a late click cannot reanchor across a newer explicit Tab or shortcut reset");
        explicitState.Click(1.1, b);
        explicitState.Key(1.11, TypingKeyAction.Typing, b);
        check(explicitSamples[^1] == new InputActivitySample(1.11, "typing"),
            "a genuinely newer click restores typing after an explicit reset");

        var unattended = new List<InputActivitySample>();
        var unattendedState = new TypingActivityState(unattended.Add);
        unattendedState.Click(.1, a);
        unattendedState.CheckFocus(1, b);
        unattendedState.Key(1.15, TypingKeyAction.Typing, b);
        unattendedState.CheckFocus(1.21, b);
        check(unattended.SequenceEqual(new[] { new InputActivitySample(.1, "reset"), new InputActivitySample(1, "reset") }),
            "a focus change without a confirming click emits its original-time reset and never types into the new focus");
        await CheckJournalAsync(expected, check);
    }

    private static async Task CheckJournalAsync(InputActivitySample[] expected, Action<bool, string> check)
    {
        var directory = Path.Combine(Path.GetTempPath(), "FrameFlow.FocusRace.Tests." + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            using (var journal = new InputActivityJournal(directory))
            {
                var reorder = new InputActivityEventBuffer(32);
                foreach (var sample in expected) reorder.TryAdd(sample);
                reorder.DrainThrough(double.PositiveInfinity, journal.Write);
                await journal.FlushAsync();
            }
            await InputActivityJournal.FinalizeAsync(directory, 0, 6);
            var restored = JsonSerializer.Deserialize<InputActivitySample[]>(File.ReadAllText(Path.Combine(directory, "input-activity.json")), Protocol.Json);
            check(restored is not null && restored.SequenceEqual(expected),
                "native journal and source-time finalization exactly preserve the fixture consumed by the camera algorithm tests");
        }
        finally
        {
            File.Delete(Path.Combine(directory, "input-activity.recovery.jsonl"));
            File.Delete(Path.Combine(directory, "input-activity.json"));
            Directory.Delete(directory);
        }
    }
}
