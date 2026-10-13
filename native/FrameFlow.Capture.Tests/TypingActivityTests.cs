using System.Buffers.Binary;
using System.Text.Json;
using FrameFlow.Capture;

internal static class TypingActivityTests
{
    internal static void Run(Action<bool, string> check)
    {
        foreach (var key in new ushort[] { 8, 13, 32, 46, 48, 57, 65, 90, 96, 111, 186, 192, 219, 226, 229, 231 })
            check(RawKeyboardActivity.Classify(key, 0, false) == TypingKeyAction.Typing,
                "text, editing, OEM and IME input classify as activity without retaining values");
        foreach (var key in new ushort[] { 9, 17, 18, 27, 91, 92, 112, 135, 162, 165 })
            check(RawKeyboardActivity.Classify(key, 0, false) == TypingKeyAction.Reset,
                "focus and shortcut keys terminate the current input anchor");
        foreach (var key in new ushort[] { 0, 16, 20, 37, 58, 144, 160, 161, 255 })
            check(RawKeyboardActivity.Classify(key, 0, false) == TypingKeyAction.Ignore,
                "bare shifts, locks, navigation and invalid keys do not generate typing");
        check(RawKeyboardActivity.Classify(65, 0, true) == TypingKeyAction.Reset,
            "a shortcut modifier already held before recording cannot appear as typing");
        check(RawKeyboardActivity.Classify(65, 1, false) == TypingKeyAction.Ignore
            && RawKeyboardActivity.Classify(9, 1, false) == TypingKeyAction.Ignore,
            "key releases neither extend typing nor establish an anchor");
        CheckPackets(check);
        CheckState(check);
        CheckBuffers(check);
        check(TypingFocusWin32.FocusModePermitsAnchor(0) && TypingFocusWin32.FocusModePermitsAnchor(1),
            "the normal blinking caret flag does not reject native text editing focus");
        foreach (var flags in new uint[] { 2, 4, 8, 16, 31 })
            check(!TypingFocusWin32.FocusModePermitsAnchor(flags), "menu, popup and window move modes cannot anchor typing");
        var sample = JsonSerializer.Serialize(new InputActivitySample(1.5, "typing"), Protocol.Json);
        using var document = JsonDocument.Parse(sample);
        check(document.RootElement.EnumerateObject().Select(value => value.Name).SequenceEqual(["t", "kind"]),
            "legacy activity omits optional focus and never stores raw input values");
        var legacy = new NativeRecordingResult("fixture", 3, 640, 480, "screen.mp4", "cursor.json", null, null,
            1, [], 3, 0);
        check(!JsonSerializer.Serialize(legacy, Protocol.Json).Contains("inputActivity"),
            "legacy native results omit optional activity metadata");
    }

    internal static async Task CheckJournalAsync(Action<bool, string> check)
    {
        var directory = Path.Combine(Path.GetTempPath(), "FrameFlow.Typing.Tests." + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            using (var journal = new InputActivityJournal(directory))
            {
                journal.Write(new(.5, "typing"));
                journal.Write(new(1, "reset"));
                journal.Write(new(1.25, "typing"));
                journal.Write(new(2, "reset"));
                journal.Write(new(2.1, "typing"));
                journal.Write(new(3, "text-or-key-value"));
                journal.Write(new(double.NaN, "typing"));
                await journal.FlushAsync();
            }
            var lines = File.ReadAllLines(Path.Combine(directory, "input-activity.recovery.jsonl"));
            check(lines.Length == 5 && lines.All(line =>
            {
                using var document = JsonDocument.Parse(line);
                return document.RootElement.EnumerateObject().Select(value => value.Name).SequenceEqual(["t", "kind"]);
            }), "recovery journal writes only finite timestamps and whitelisted categories with no raw input fields");
            await InputActivityJournal.FinalizeAsync(directory, 1, 1);
            var finalized = JsonSerializer.Deserialize<InputActivitySample[]>(
                File.ReadAllText(Path.Combine(directory, "input-activity.json")), Protocol.Json);
            check(finalized is not null && finalized.SequenceEqual(new[]
            {
                new InputActivitySample(0, "reset"), new InputActivitySample(.25, "typing"), new InputActivitySample(1, "reset")
            }), "final activity timeline uses the common recording origin, clips both ends and retains boundary resets");
            await InputActivityJournal.FinalizeAsync(directory, 10, 1);
            check(File.ReadAllText(Path.Combine(directory, "input-activity.json")) == "[]",
                "a recording without activity produces a valid empty JSON array");
        }
        finally
        {
            File.Delete(Path.Combine(directory, "input-activity.recovery.jsonl"));
            File.Delete(Path.Combine(directory, "input-activity.json"));
            Directory.Delete(directory);
        }
    }

    private static void CheckPackets(Action<bool, string> check)
    {
        foreach (var pointerSize in new[] { 4, 8 })
        {
            var header = 8 + pointerSize * 2;
            var bytes = new byte[header + 16];
            BinaryPrimitives.WriteUInt32LittleEndian(bytes, 1);
            BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), (uint)bytes.Length);
            BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(header + 6), 65);
            check(RawKeyboardActivity.TryClassify(bytes, pointerSize, false, out var action)
                && action == TypingKeyAction.Typing, "keyboard packets parse on x86/x64 including zero device handles");
            BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(header + 2), 1);
            check(RawKeyboardActivity.TryClassify(bytes, pointerSize, false, out action)
                && action == TypingKeyAction.Ignore, "raw keyboard release flags are honored");
            check(!RawKeyboardActivity.TryClassify(bytes.AsSpan(0, header + 15), pointerSize, false, out _),
                "truncated keyboard packets are rejected");
            bytes[4]--;
            check(!RawKeyboardActivity.TryClassify(bytes, pointerSize, false, out _),
                "mismatched declared raw keyboard sizes are rejected");
            bytes[4]++;
            bytes[0] = 0;
            check(!RawKeyboardActivity.TryClassify(bytes, pointerSize, false, out _),
                "mouse packets cannot be misinterpreted as keyboard activity");
        }
        check(!RawKeyboardActivity.TryClassify([], 16, false, out _), "unsupported raw input layouts are rejected");
    }

    private static void CheckState(Action<bool, string> check)
    {
        var samples = new List<InputActivitySample>();
        var state = new TypingActivityState(samples.Add);
        var focus = new InputFocus(10, 20);
        state.Key(0, TypingKeyAction.Typing, focus);
        check(samples.Count == 0, "typing without a recorded trusted click is not emitted");
        state.Click(1, focus);
        state.Key(1.05, TypingKeyAction.Typing, focus);
        state.Key(1.09, TypingKeyAction.Typing, focus);
        state.Key(1.2, TypingKeyAction.Typing, focus);
        check(samples.Select(value => value.Kind).SequenceEqual(["reset", "typing", "typing"]),
            "a trusted click resets before typing and repeated activity is capped at ten samples per second");
        state.CheckFocus(1.3, focus);
        check(samples.Count == 3, "unchanged foreground and focus retain the input anchor without mouse location checks");
        state.CheckFocus(1.4, new InputFocus(10, 21));
        state.Key(1.5, TypingKeyAction.Typing, new InputFocus(10, 21));
        state.FlushFocusReset(1.7);
        check(samples.Count == 4 && samples[^1] == new InputActivitySample(1.4, "reset"),
            "native focus changes reset even without a key and do not reanchor implicitly");
        state.Click(2, focus);
        state.Key(2.1, TypingKeyAction.Reset, focus);
        state.Key(2.2, TypingKeyAction.Typing, focus);
        check(samples.Count == 6 && samples[^1].Kind == "reset", "shortcuts clear the anchor until another trusted click");
        state.Click(3, focus);
        state.Key(3.1, TypingKeyAction.Typing, focus);
        state.Click(3.2, default);
        state.Key(3.4, TypingKeyAction.Typing, focus);
        check(samples.Count == 9 && samples[^1] == new InputActivitySample(3.2, "reset"),
            "outside or untrusted clicks terminate typing without creating a new anchor");
        state.Click(4, focus);
        state.Key(3.9, TypingKeyAction.Typing, focus);
        check(samples.Count == 10, "a key timestamp preceding its anchor never extends the new target");
        state.CheckFocus(4.2, new InputFocus(30, 40));
        state.FlushFocusReset(4.5);
        check(samples[^1] == new InputActivitySample(4.2, "reset"), "foreground window changes invalidate an anchor");
        state.Click(5, focus);
        state.Key(5.1, TypingKeyAction.Typing, focus);
        state.CheckFocus(5.15, default);
        state.FlushFocusReset(5.4);
        check(samples[^1] == new InputActivitySample(5.15, "reset"),
            "unavailable or menu focus is treated conservatively as an input boundary");
    }

    private static void CheckBuffers(Action<bool, string> check)
    {
        var queue = new BoundedActivityQueue<InputActivitySample>(2);
        check(queue.TryEnqueue(new(1, "typing")) && queue.TryEnqueue(new(2, "reset"))
            && !queue.TryEnqueue(new(3, "typing")), "bounded producer queue explicitly reports overflow instead of silently losing resets");
        check(queue.TryDequeue(out var a) && a.Kind == "typing" && queue.TryDequeue(out var b) && b.Kind == "reset"
            && !queue.TryDequeue(out _), "bounded queue keeps reset ordering and drains completely");
        check(queue.TryEnqueue(new(4, "reset")), "queue capacity is reusable after draining");
        var buffer = new InputActivityEventBuffer(3);
        check(buffer.TryAdd(new(1.04, "typing")) && buffer.TryAdd(new(1, "reset"))
            && buffer.TryAdd(new(1.04, "reset")) && !buffer.TryAdd(new(2, "typing")),
            "reorder buffer is also bounded with explicit failure on capacity exhaustion");
        var ordered = new List<InputActivitySample>();
        buffer.DrainThrough(1, ordered.Add);
        check(ordered.SequenceEqual([new InputActivitySample(1, "reset")]),
            "a slightly delayed mouse reset retains the exact click timestamp ahead of newer typing");
        buffer.DrainThrough(double.PositiveInfinity, ordered.Add);
        check(ordered.Select(value => value.Kind).SequenceEqual(["reset", "typing", "reset"]),
            "reorder buffer preserves deterministic arrival order for equal timestamps and final flush drains all events");
    }
}
