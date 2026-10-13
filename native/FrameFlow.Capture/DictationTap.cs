using NAudio.Wave;

namespace FrameFlow.Capture;

/** A clip of the existing microphone before recording mute; failures never stop the recorder. */
internal sealed class DictationTap(WaveFormat format) : IDisposable
{
    private readonly object gate = new();
    private WaveFileWriter? writer;
    private string? id;
    private long bytes;
    private Exception? failure;
    private DateTime levelAt;
    private TaskCompletionSource? ready;

    internal async Task BeginAsync(string directory, string clipId, CancellationToken cancellation)
    {
        Task wait;
        lock (gate)
        {
            if (writer is not null) throw new InvalidOperationException("正在录入语音，请先松开鼠标。");
            if (!Guid.TryParse(clipId, out _)) throw new ArgumentException("语音片段无效。");
            Directory.CreateDirectory(directory);
            writer = new WaveFileWriter(new FileStream(Path.Combine(directory, "microphone.wav"),
                FileMode.CreateNew, FileAccess.Write, FileShare.Read), format);
            id = clipId; bytes = 0; failure = null; levelAt = DateTime.MinValue;
            ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            wait = ready.Task;
        }
        try { await wait.WaitAsync(TimeSpan.FromSeconds(3), cancellation); }
        catch { Cancel(clipId); throw; }
    }

    internal void Append(byte[] samples, int offset, int count)
    {
        lock (gate)
        {
            if (writer is null || failure is not null) return;
            var remaining = (long)format.AverageBytesPerSecond * 30 - bytes;
            count = (int)Math.Min(count, remaining);
            count -= count % format.BlockAlign;
            if (count <= 0) return;
            try
            {
                writer.Write(samples, offset, count); bytes += count;
                ready?.TrySetResult();
                if ((DateTime.UtcNow - levelAt).TotalMilliseconds >= 80)
                {
                    levelAt = DateTime.UtcNow;
                    Protocol.Write(new { @event = "dictation-level", dictationId = id, level = AudioLevel.Measure(samples, offset, count, format) });
                }
            }
            catch (Exception error) { failure = error; ready?.TrySetException(error); }
        }
    }

    internal object End(string clipId)
    {
        lock (gate)
        {
            if (writer is null || id != clipId) throw new InvalidOperationException("语音片段已结束。");
            var duration = (double)bytes / format.AverageBytesPerSecond;
            var error = failure;
            Close();
            if (error is not null) throw new IOException("语音采集中断，请重试。", error);
            if (duration < .15) throw new IOException("没有检测到可用语音，请重试。");
            return new { duration };
        }
    }

    internal void Cancel(string clipId) { lock (gate) { if (id == clipId) Close(); } }
    private void Close()
    {
        var previous = writer; writer = null; id = null;
        ready?.TrySetException(new OperationCanceledException("语音录入已取消。")); ready = null;
        previous?.Dispose();
    }
    public void Dispose() { lock (gate) Close(); }
}
