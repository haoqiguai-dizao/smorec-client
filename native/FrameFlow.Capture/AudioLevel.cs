using NAudio.Wave;

namespace FrameFlow.Capture;

internal static class AudioLevel
{
    internal static double Measure(byte[] buffer, int offset, int count, WaveFormat format)
    {
        var floating = format.Encoding == WaveFormatEncoding.IeeeFloat
            || format is WaveFormatExtensible ext && ext.SubFormat == new Guid("00000003-0000-0010-8000-00aa00389b71");
        var width = format.BitsPerSample / 8;
        double power = 0; var samples = 0;
        for (var i = offset; i + width <= offset + count; i += width)
        {
            double sample = floating && width == 4 ? BitConverter.ToSingle(buffer, i)
                : width == 2 ? BitConverter.ToInt16(buffer, i) / 32768.0
                : width == 4 ? BitConverter.ToInt32(buffer, i) / 2147483648.0
                : width == 3 ? (buffer[i] | buffer[i + 1] << 8 | (sbyte)buffer[i + 2] << 16) / 8388608.0 : 0;
            if (!double.IsFinite(sample)) continue;
            power += sample * sample; samples++;
        }
        return samples > 0 ? Math.Clamp(Math.Sqrt(power / samples) * 4, 0, 1) : 0;
    }
}
