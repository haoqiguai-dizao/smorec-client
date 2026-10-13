using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using NAudio.Dsp;

namespace FrameFlow.Capture;

internal sealed class LiveAudioResampler
{
    private readonly WaveFormat format;
    private readonly BufferedWaveProvider buffered;
    private readonly ISampleProvider stereo;
    private WdlResampler resampled;
    private readonly float[] samples = new float[48000];
    private readonly Action<float[], int, double> publish;
    private double next;
    internal LiveAudioResampler(WaveFormat format, Action<float[], int, double> publish)
    {
        this.format = format; this.publish = publish;
        buffered = new BufferedWaveProvider(format.AsStandardWaveFormat()) { ReadFully = false, BufferDuration = TimeSpan.FromSeconds(1) };
        ISampleProvider source = buffered.ToSampleProvider();
        stereo = source.WaveFormat.Channels == 1 ? new MonoToStereoSampleProvider(source)
            : source.WaveFormat.Channels == 2 ? source : new LiveStereoSampleProvider(source, format);
        resampled = CreateResampler();
    }
    private WdlResampler CreateResampler()
    {
        var resampler = new WdlResampler();
        resampler.SetMode(true, 2, false); resampler.SetFilterParms();
        // Live packets are not EOF. Feed mode retains interpolation history between packets.
        resampler.SetFeedMode(true); resampler.SetRates(format.SampleRate, 48000);
        return resampler;
    }
    internal void Append(byte[] bytes, AudioPacketPlan plan, long timelineFrames)
    {
        if (plan.SilenceFrames > 0)
        {
            buffered.ClearBuffer(); resampled = CreateResampler();
            next = (timelineFrames - plan.WriteFrames) / (double)format.SampleRate;
        }
        if (plan.WriteFrames <= 0) return;
        buffered.AddSamples(bytes, plan.SkipFrames * format.BlockAlign, plan.WriteFrames * format.BlockAlign);
        var requested = resampled.ResamplePrepare(plan.WriteFrames, 2, out var input, out var offset);
        var read = stereo.Read(input, offset, requested * 2) / 2;
        var count = resampled.ResampleOut(samples, 0, read, samples.Length / 2, 2) * 2;
        if (count > 0) { publish(samples, count, next); next += count / 96000d; }
    }
}
