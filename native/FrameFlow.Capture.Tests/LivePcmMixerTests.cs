using FrameFlow.Capture;
using NAudio.Wave;

internal static class LivePcmMixerTests
{
    internal static void Run(Action<bool, string> check)
    {
        var mixer = new LivePcmMixer(true, true);
        mixer.Push(0, [.8f, .4f, 1f, -1f], 4, 0);
        mixer.Push(1, [.4f, .2f, .5f, -.5f], 4, 0);
        var result = mixer.Pull(.12 + 2.1d / 48000);
        check(result.Data.Length == 16, "live PCM reads the requested native-clock samples");
        check(Math.Abs(BitConverter.ToSingle(result.Data, 0) - .6f) < .0001f, "live PCM mixes system and microphone with headroom");
        check(Math.Abs(BitConverter.ToSingle(result.Data, 12) + .75f) < .0001f, "live PCM preserves channel order and polarity");
        var empty = mixer.Pull(.12 + 3.1d / 48000);
        check(empty.Data.All(value => value == 0), "missing packets produce clock-aligned silence");
        var delayed = mixer.Pull(10);
        check(delayed.Data.Length <= 24000 * 8 && delayed.Time >= 9, "long consumer stalls do not grow an audio queue");
        var clipped = new LivePcmMixer(false, true);
        clipped.Push(1, [2f, float.NaN], 2, 0);
        var final = clipped.Pull(.12 + 1.1d / 48000);
        check(BitConverter.ToSingle(final.Data, 0) == 1 && BitConverter.ToSingle(final.Data, 4) == 0, "PCM clips and rejects non-finite values");
        var format = new WaveFormatExtensible(48000, 32, 6);
        var provider = new BufferedWaveProvider(format.AsStandardWaveFormat()) { ReadFully = false };
        var pcm = new byte[6 * 4]; BitConverter.GetBytes(.5f).CopyTo(pcm, 2 * 4); provider.AddSamples(pcm, 0, pcm.Length);
        var downmix = new LiveStereoSampleProvider(provider.ToSampleProvider(), format); var stereo = new float[2];
        check(downmix.Read(stereo, 0, 2) == 2 && Math.Abs(stereo[0] - .35355f) < .0001f && stereo[0] == stereo[1], "5.1 center-channel speech survives stereo downmix");
        var surroundFormat = new WaveFormatExtensible(48000, 32, 8, 0x63f);
        var surround = new BufferedWaveProvider(surroundFormat.AsStandardWaveFormat()) { ReadFully = false };
        var surroundPcm = new byte[8 * 4]; BitConverter.GetBytes(.5f).CopyTo(surroundPcm, 7 * 4); surround.AddSamples(surroundPcm, 0, surroundPcm.Length);
        var surroundMixer = new LiveStereoSampleProvider(surround.ToSampleProvider(), surroundFormat);
        surroundMixer.Read(stereo, 0, 2);
        check(stereo[0] == 0 && Math.Abs(stereo[1] - .35355f) < .0001f, "7.1 side channels follow the actual speaker mask");
        Resampling(check);
    }
    private static void Resampling(Action<bool, string> check)
    {
        var outputs = new List<(float[] Samples, double Time)>();
        var format = WaveFormat.CreateIeeeFloatWaveFormat(16000, 1);
        var converter = new LiveAudioResampler(format, (samples, count, time) => outputs.Add((samples.Take(count).ToArray(), time)));
        var planner = new AudioPacketPlanner(16000, false);
        var input = new float[160]; var packet = new byte[input.Length * 4];
        for (var index = 0; index < 100; index++)
        {
            for (var sample = 0; sample < input.Length; sample++) input[sample] = .2f * MathF.Sin((index * 160 + sample) * MathF.PI * 2 * 440 / 16000);
            Buffer.BlockCopy(input, 0, packet, 0, packet.Length);
            var plan = planner.Plan(index * 160, 160, .5 + index * .01 + (index % 2 == 0 ? 0 : .006), .51 + index * .01);
            converter.Append(packet, plan, planner.WrittenFrames);
        }
        var total = outputs.Sum(output => output.Samples.Length / 2);
        check(total >= 47900 && total <= 48000, $"live resampling produces one second of real PCM without arbitrary padding (frames={total}, packets={outputs.Count})");
        check(Math.Abs(outputs[0].Time - .5) < .0001 && outputs.Skip(1).Select((output, index) => Math.Abs(output.Time - outputs[index].Time - outputs[index].Samples.Length / 96000d)).All(delta => delta < .00001), "jittered packet arrival preserves continuous native-clock resampled audio");
        check(outputs.All(output => output.Samples.Chunk(2).All(pair => pair.Length == 2 && pair[0] == pair[1])), "mono microphones reach both output channels");
        var gap = planner.Plan(32000, 160, 2.5, 2.51);
        converter.Append(packet, gap, planner.WrittenFrames);
        check(Math.Abs(outputs[^1].Time - 2.5) < .0001, "real source gaps reset resampling at the hardware timeline");
    }
}
