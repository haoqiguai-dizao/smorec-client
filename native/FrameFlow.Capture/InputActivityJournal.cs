using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FrameFlow.Capture;

internal sealed class BoundedActivityQueue<T>(int capacity)
{
    private readonly ConcurrentQueue<T> items = new();
    private int count;

    internal bool TryEnqueue(T item)
    {
        if (Interlocked.Increment(ref count) > capacity)
        {
            Interlocked.Decrement(ref count);
            return false;
        }
        items.Enqueue(item);
        return true;
    }

    internal bool TryDequeue(out T item)
    {
        if (!items.TryDequeue(out item!)) return false;
        Interlocked.Decrement(ref count);
        return true;
    }
}

internal sealed class InputActivityEventBuffer(int capacity)
{
    private readonly PriorityQueue<InputActivitySample, (double Time, long Order)> pending = new();
    private long order;

    internal bool TryAdd(InputActivitySample sample)
    {
        if (pending.Count >= capacity) return false;
        pending.Enqueue(sample, (sample.T, order++));
        return true;
    }

    internal void DrainThrough(double time, Action<InputActivitySample> write)
    {
        while (pending.TryPeek(out var sample, out _) && sample.T <= time) write(pending.Dequeue());
    }
}

internal sealed class InputActivityJournal : IDisposable
{
    private static readonly JsonSerializerOptions ReadJson = new(Protocol.Json)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private readonly StreamWriter journal;
    private double lastTime;

    internal InputActivityJournal(string directory)
    {
        journal = new StreamWriter(new FileStream(Path.Combine(directory, "input-activity.recovery.jsonl"),
            FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(false));
    }

    internal void Write(InputActivitySample sample)
    {
        if (!double.IsFinite(sample.T) || sample.T < 0 || sample.Kind is not ("typing" or "reset")) return;
        if (sample.Focus is not null && (sample.Kind != "typing" || !TypingFocusGeometry.Valid(sample.Focus))) return;
        lastTime = Math.Max(lastTime, sample.T);
        journal.WriteLine(JsonSerializer.Serialize(sample with { T = lastTime }, Protocol.Json));
    }

    internal Task FlushAsync() => journal.FlushAsync();
    public void Dispose() => journal.Dispose();

    internal static async Task FinalizeAsync(string directory, double origin, double duration)
    {
        using var output = new StreamWriter(Path.Combine(directory, "input-activity.json"), false, new UTF8Encoding(false));
        await output.WriteAsync("[");
        var first = true;
        var lastTime = 0d;
        foreach (var line in File.ReadLines(Path.Combine(directory, "input-activity.recovery.jsonl")))
        {
            var sample = JsonSerializer.Deserialize<InputActivitySample>(line, ReadJson);
            if (sample is null || !double.IsFinite(sample.T) || sample.T < 0 || sample.Kind is not ("typing" or "reset")
                || (sample.Focus is not null && (sample.Kind != "typing" || !TypingFocusGeometry.Valid(sample.Focus))))
                throw new InvalidDataException("Input activity journal contains an invalid event.");
            if (sample.T < origin || sample.T > origin + duration) continue;
            if (!first) await output.WriteAsync(",");
            lastTime = Math.Max(lastTime, sample.T - origin);
            await output.WriteAsync(JsonSerializer.Serialize(sample with { T = lastTime }, Protocol.Json));
            first = false;
        }
        await output.WriteAsync("]");
    }
}
