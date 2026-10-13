using System.Buffers.Binary;
using NAudio.Wave;

namespace FrameFlow.Capture;

// WAVE speaker-mask order, including 5.1/7.1 center and surround channels.
internal sealed class LiveStereoSampleProvider : ISampleProvider
{
    private readonly ISampleProvider source;
    private readonly (float Left, float Right)[] weights;
    private float[] input = [];
    public WaveFormat WaveFormat { get; }
    internal LiveStereoSampleProvider(ISampleProvider source, WaveFormat original)
    {
        this.source = source;
        var channels = source.WaveFormat.Channels;
        if (channels is < 1 or > 32) throw new IOException("直播声音声道数无效。");
        WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate, 2);
        uint mask = 0;
        if (original is WaveFormatExtensible)
        {
            using var data = new MemoryStream(); using var writer = new BinaryWriter(data);
            original.Serialize(writer); writer.Flush();
            // Serialize prefixes the standard 18-byte fmt with its 4-byte length,
            // then validBits (2), channelMask (4), and subformat (16).
            mask = BinaryPrimitives.ReadUInt32LittleEndian(data.ToArray().AsSpan(24, 4));
        }
        if (mask == 0) mask = channels == 32 ? uint.MaxValue : (1u << channels) - 1;
        var positions = Enumerable.Range(0, 32).Where(bit => (mask & (1u << bit)) != 0).ToArray();
        if (positions.Length != channels) throw new IOException("直播声音声道布局无效。");
        weights = positions.Select(bit => bit switch {
            0 => (1f, 0f), 1 => (0f, 1f), 3 => (0f, 0f),
            4 or 6 or 9 or 12 or 15 => (.7071f, 0f),
            5 or 7 or 10 or 14 or 17 => (0f, .7071f),
            _ => (.7071f, .7071f)
        }).ToArray();
    }
    public int Read(float[] buffer, int offset, int count)
    {
        var requested = count / 2 * weights.Length;
        if (input.Length < requested) Array.Resize(ref input, requested);
        var read = source.Read(input, 0, requested);
        var frames = read / weights.Length;
        for (var frame = 0; frame < frames; frame++)
        {
            float left = 0, right = 0;
            for (var channel = 0; channel < weights.Length; channel++)
            {
                var sample = input[frame * weights.Length + channel];
                if (!float.IsFinite(sample)) continue;
                left += sample * weights[channel].Left; right += sample * weights[channel].Right;
            }
            buffer[offset + frame * 2] = left; buffer[offset + frame * 2 + 1] = right;
        }
        return frames * 2;
    }
}
