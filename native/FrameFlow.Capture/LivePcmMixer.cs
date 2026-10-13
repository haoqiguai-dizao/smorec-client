namespace FrameFlow.Capture;

internal record LiveAudioPacket(byte[] Data, double Time);

// Three seconds of timestamp-indexed stereo PCM. No growing audio queues or files.
internal sealed class LivePcmMixer
{
    private const int Rate = 48000, Capacity = Rate * 3;
    private readonly object gate = new();
    private readonly float[][] samples = [new float[Capacity * 2], new float[Capacity * 2]];
    private readonly long[][] stamps = [Enumerable.Repeat(-1L, Capacity).ToArray(), Enumerable.Repeat(-1L, Capacity).ToArray()];
    private bool[] enabled;
    private long read;
    internal LivePcmMixer(bool system, bool microphone) => enabled = [system, microphone];
    internal bool IsEnabled(int track) { lock (gate) return enabled[track]; }
    internal void SetEnabled(bool system, bool microphone)
    {
        lock (gate)
        {
            bool[] next = [system, microphone];
            for (var track = 0; track < 2; track++)
                if (next[track] != enabled[track]) Array.Fill(stamps[track], -1L);
            enabled = next;
        }
    }

    internal void Push(int track, float[] data, int count, double time)
    {
        var start = (long)Math.Round(time * Rate);
        lock (gate)
        {
            if (!enabled[track]) return;
            for (var index = 0; index < count / 2; index++)
            {
                var frame = start + index;
                if (frame < 0 || frame < read) continue;
                var slot = (int)(frame % Capacity);
                stamps[track][slot] = frame;
                for (var channel = 0; channel < 2; channel++)
                {
                    var sample = data[index * 2 + channel];
                    samples[track][slot * 2 + channel] = float.IsFinite(sample) ? sample : 0;
                }
            }
        }
    }
    internal LiveAudioPacket Pull(double now)
    {
        lock (gate)
        {
            var end = (long)Math.Floor(Math.Max(0, now - .12) * Rate);
            read = Math.Max(read, end - Rate / 2);
            var start = read;
            var count = (int)Math.Max(0, end - start);
            var output = new float[count * 2];
            var gain = enabled[0] && enabled[1] ? .5f : 1f;
            for (var index = 0; index < count; index++)
            {
                var frame = start + index; var slot = (int)(frame % Capacity);
                for (var channel = 0; channel < 2; channel++)
                {
                    float sample = 0;
                    for (var track = 0; track < 2; track++)
                        if (enabled[track] && stamps[track][slot] == frame) sample += samples[track][slot * 2 + channel] * gain;
                    output[index * 2 + channel] = Math.Clamp(sample, -1f, 1f);
                }
            }
            read = end;
            var bytes = new byte[output.Length * 4];
            Buffer.BlockCopy(output, 0, bytes, 0, bytes.Length);
            return new LiveAudioPacket(bytes, start / (double)Rate);
        }
    }
}
