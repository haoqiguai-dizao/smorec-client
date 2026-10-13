using System.Runtime.InteropServices;
using FrameFlow.Capture;

internal static class AudioPacketPlannerTests
{
    internal static void Run(Action<bool, string> check)
    {
        foreach (var rate in new[] { 16_000, 48_000 })
        {
            ContinuousPackets(rate, false, check);
            ContinuousPackets(rate, true, check);
            LeadingTimestamp(rate, check);
            InitialTimestampFallback(rate, check);
            DeviceGap(rate, check);
            OverlappingPackets(rate, check);
            DeviceResets(rate, check);
            LoopbackWallGap(rate, check);
            LoopbackGapWithMissingPacket(rate, check);
            WallGapRequiresBothClocks(rate, check);
            SilentPacket(rate, check);
            OldTimestampAlgorithmCounterexample(rate, check);
        }
        InterleavedStereo(check);
    }

    private static void ContinuousPackets(int rate, bool loopback, Action<bool, string> check)
    {
        var frames = rate / 100;
        var source = Sine(frames * 1000, rate);
        var planner = new AudioPacketPlanner(rate, loopback);
        using var output = new MemoryStream();
        var missing = 0;
        var arrival = .032;
        var drain = 0;
        var allWhole = true;
        for (var packet = 0; packet < 1000; packet++)
        {
            var start = packet * frames / (double)rate;
            // Buffered reads arrive in alternating 32/56 ms batches. Packet QPC
            // independently jitters by +/-6 ms or becomes unavailable.
            while (arrival < start + frames / (double)rate)
                arrival += ++drain % 2 == 1 ? .056 : .032;
            double? timestamp = packet == 0 ? 0 : packet % 7 == 0 ? null
                : start + (packet % 2 == 0 ? -.006 : .006);
            if (timestamp is null) missing++;
            var plan = planner.Plan(900_000L + packet * frames, frames, timestamp, arrival, packet == 357);
            allWhole &= plan.SilenceFrames == 0 && plan.SkipFrames == 0 && plan.WriteFrames == frames;
            Append(output, source.AsSpan(packet * frames, frames), plan);
        }
        var label = $"{rate} Hz {(loopback ? "loopback" : "microphone")}";
        check(allWhole && SameSamples(output, source), $"{label}: 1000 jittered packets preserve every sample and byte");
        check(LongestZeroRun(output) == 0, $"{label}: timestamp jitter introduces no zero runs");
        check(planner.WrittenFrames == source.Length && planner.LeadingFrames == 0
            && planner.GapFrames == 0 && planner.SkippedFrames == 0 && planner.Resets == 0
            && planner.TimestampGapResyncs == 0 && planner.TimestampErrors == missing
            && planner.Discontinuities == 1, $"{label}: continuous device frames never trigger timing repairs");
    }

    private static void LeadingTimestamp(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        var source = Sine(frames * 2, rate);
        var planner = new AudioPacketPlanner(rate, false);
        using var output = new MemoryStream();
        var first = planner.Plan(123_456, frames, .25, .27);
        Append(output, source.AsSpan(0, frames), first);
        Append(output, source.AsSpan(frames), planner.Plan(123_456 + frames, frames, null, .5));
        var expected = new float[rate / 4 + source.Length];
        source.CopyTo(expected, rate / 4);
        check(first.SilenceFrames == rate / 4 && SameSamples(output, expected),
            $"{rate} Hz: first valid QPC sets the global anchor independently of device position");
        check(planner.LeadingFrames == rate / 4 && planner.WrittenFrames == expected.Length
            && planner.GapFrames == 0 && planner.TimestampErrors == 1,
            $"{rate} Hz: later missing QPC does not change the initial anchor");
    }

    private static void InitialTimestampFallback(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        var source = Sine(frames * 3, rate);
        var planner = new AudioPacketPlanner(rate, false);
        using var output = new MemoryStream();
        Append(output, source.AsSpan(0, frames), planner.Plan(777, frames, null, .51));
        Append(output, source.AsSpan(frames, frames), planner.Plan(777 + frames, frames, null, .85));
        Append(output, source.AsSpan(frames * 2, frames), planner.Plan(777 + frames * 2, frames, .9, .92));
        var expected = new float[rate / 2 + source.Length];
        source.CopyTo(expected, rate / 2);
        check(SameSamples(output, expected) && planner.LeadingFrames == rate / 2
            && planner.GapFrames == 0 && planner.SkippedFrames == 0 && planner.TimestampErrors == 2,
            $"{rate} Hz: now minus packet duration is used only for the first missing timestamp");
    }

    private static void DeviceGap(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        var gap = rate / 20;
        var source = Sine(frames * 2, rate);
        var planner = new AudioPacketPlanner(rate, false);
        using var output = new MemoryStream();
        Append(output, source.AsSpan(0, frames), planner.Plan(10_000, frames, 0, .01));
        var second = planner.Plan(10_000 + frames + gap, frames, .06, .07);
        Append(output, source.AsSpan(frames), second);
        var expected = new float[source.Length + gap];
        source.AsSpan(0, frames).CopyTo(expected);
        source.AsSpan(frames).CopyTo(expected.AsSpan(frames + gap));
        check(second.SilenceFrames == gap && second.SkipFrames == 0 && SameSamples(output, expected),
            $"{rate} Hz: a forward device gap inserts exactly the missing frames");
        check(planner.GapFrames == gap && planner.WrittenFrames == expected.Length
            && planner.Discontinuities == 0 && planner.SkippedFrames == 0,
            $"{rate} Hz: real gaps are preserved even without a discontinuity flag");
    }

    private static void OverlappingPackets(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        var source = Sine(frames * 5 / 2, rate);
        var planner = new AudioPacketPlanner(rate, false);
        using var output = new MemoryStream();
        Append(output, source.AsSpan(0, frames), planner.Plan(1000, frames, 0, .01));
        var overlap = planner.Plan(1000 + frames / 2, frames, .005, .015);
        Append(output, source.AsSpan(frames / 2, frames), overlap);
        var duplicate = planner.Plan(1000 + frames / 2, frames, .005, .016);
        Append(output, source.AsSpan(frames / 2, frames), duplicate);
        Append(output, source.AsSpan(frames * 3 / 2, frames),
            planner.Plan(1000 + frames * 3 / 2, frames, .015, .025));
        check(overlap.SkipFrames == frames / 2 && overlap.WriteFrames == frames / 2
            && duplicate.SkipFrames == frames && duplicate.WriteFrames == 0 && SameSamples(output, source),
            $"{rate} Hz: partial overlaps and duplicate packets never duplicate audible samples");
        check(planner.SkippedFrames == frames * 3 / 2 && planner.GapFrames == 0 && planner.Resets == 0,
            $"{rate} Hz: overlapping forward positions are not mistaken for a device reset");
    }

    private static void DeviceResets(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        foreach (var timestamp in new double?[] { null, .10, .27, .51 })
        {
            var planner = new AudioPacketPlanner(rate, false);
            var source = Sine(frames * 2, rate);
            using var output = new MemoryStream();
            Append(output, source.AsSpan(0, frames), planner.Plan(10_000, frames, .25, .26));
            var reset = planner.Plan(0, frames, timestamp, .53, true);
            Append(output, source.AsSpan(frames), reset);
            var gap = timestamp == .51 ? rate / 4 : 0;
            var expected = new float[rate / 4 + frames * 2 + gap];
            source.AsSpan(0, frames).CopyTo(expected.AsSpan(rate / 4));
            source.AsSpan(frames).CopyTo(expected.AsSpan(rate / 4 + frames + gap));
            check(reset.SilenceFrames == gap && reset.SkipFrames == 0 && SameSamples(output, expected),
                $"{rate} Hz: device reset with {timestamp?.ToString() ?? "missing"} QPC preserves the intended timeline");
            check(planner.Resets == 1 && planner.Discontinuities == 1 && planner.GapFrames == gap
                && planner.SkippedFrames == 0 && planner.WrittenFrames == expected.Length,
                $"{rate} Hz: reset diagnostics distinguish small jitter from a real wall-clock gap");
        }
    }

    private static void LoopbackWallGap(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        var gap = rate / 5;
        var source = Sine(frames * 3, rate);
        var planner = new AudioPacketPlanner(rate, true);
        using var output = new MemoryStream();
        Append(output, source.AsSpan(0, frames), planner.Plan(10_000, frames, 0, .01));
        var resumed = planner.Plan(10_000 + frames, frames, .21, .22);
        Append(output, source.AsSpan(frames, frames), resumed);
        Append(output, source.AsSpan(frames * 2), planner.Plan(10_000 + frames * 2, frames, .22, .23));
        var expected = new float[source.Length + gap];
        source.AsSpan(0, frames).CopyTo(expected);
        source.AsSpan(frames).CopyTo(expected.AsSpan(frames + gap));
        check(resumed.SilenceFrames == gap && SameSamples(output, expected)
            && planner.TimestampGapResyncs == 1 && planner.GapFrames == gap,
            $"{rate} Hz: loopback stop and resume preserves wall-clock silence exactly once");
    }

    private static void WallGapRequiresBothClocks(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        foreach (var scenario in new[]
        {
            (Name: "QPC jump alone", Loopback: true, FirstNow: .30, Timestamp: .21, Now: .31),
            (Name: "arrival delay alone", Loopback: true, FirstNow: .01, Timestamp: .01, Now: .22),
            (Name: "continuous microphone", Loopback: false, FirstNow: .01, Timestamp: .21, Now: .22)
        })
        {
            var planner = new AudioPacketPlanner(rate, scenario.Loopback);
            planner.Plan(1000, frames, 0, scenario.FirstNow);
            var plan = planner.Plan(1000 + frames, frames, scenario.Timestamp, scenario.Now);
            check(plan.SilenceFrames == 0 && plan.SkipFrames == 0 && plan.WriteFrames == frames
                && planner.TimestampGapResyncs == 0 && planner.GapFrames == 0,
                $"{rate} Hz: {scenario.Name} cannot manufacture a loopback silence gap");
        }
    }

    private static void SilentPacket(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        var source = Sine(frames * 3, rate);
        Array.Clear(source, frames, frames);
        var planner = new AudioPacketPlanner(rate, false);
        using var output = new MemoryStream();
        for (var packet = 0; packet < 3; packet++)
            Append(output, source.AsSpan(packet * frames, frames),
                planner.Plan(packet * frames, frames, packet == 1 ? null : packet * .01, (packet + 1) * .01));
        check(SameSamples(output, source) && LongestZeroRun(output) == frames
            && planner.WrittenFrames == source.Length && planner.GapFrames == 0 && planner.SkippedFrames == 0,
            $"{rate} Hz: a silent packet keeps its entire duration between audible packets");
    }

    private static void LoopbackGapWithMissingPacket(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        var planner = new AudioPacketPlanner(rate, true);
        planner.Plan(10_000, frames, 0, .01);
        // The loopback counter froze during silence, and its first resumed packet was lost.
        var resumed = planner.Plan(10_000 + 2 * frames, frames, .22, .23);
        check(resumed.SilenceFrames == rate * 21 / 100 && resumed.SkipFrames == 0
            && planner.WrittenFrames == rate * 23 / 100,
            $"{rate} Hz: a paused loopback plus missing resume packet preserves the complete wall-clock gap");
        var following = planner.Plan(10_000 + 3 * frames, frames, .23, .24);
        check(following.SilenceFrames == 0 && planner.TimestampGapResyncs == 1
            && planner.GapFrames == rate * 21 / 100 && planner.WrittenFrames == rate * 24 / 100,
            $"{rate} Hz: resumed loopback does not count its device gap twice or reinsert the pause");
    }

    private static void OldTimestampAlgorithmCounterexample(int rate, Action<bool, string> check)
    {
        var frames = rate / 100;
        var source = Sine(frames * 1000, rate);
        using var output = new MemoryStream();
        long written = 0, inserted = 0, skipped = 0, firstGap = 0;
        for (var packet = 0; packet < 1000; packet++)
        {
            var timestamp = packet * frames / (double)rate + (packet == 0 ? 0 : packet % 2 == 1 ? .006 : -.006);
            var target = (long)(Math.Max(0, timestamp) * rate);
            var silence = target > written + rate / 1000 ? target - written : 0;
            if (packet == 1) firstGap = silence;
            written += silence;
            var skip = target < written - rate / 1000 ? (int)Math.Min(frames, written - target) : 0;
            Append(output, source.AsSpan(packet * frames, frames), new AudioPacketPlan(silence, skip, frames - skip));
            written += frames - skip; inserted += silence; skipped += skip;
        }
        check(firstGap == rate * 6 / 1000 && inserted > 0 && skipped > 0
            && LongestZeroRun(output) >= rate * 6 / 1000 && !SameSamples(output, source),
            $"{rate} Hz: the old +/-1 ms correction demonstrably inserts 6 ms silence and discards sine samples");
    }

    private static float[] Sine(int frames, int rate) => Enumerable.Range(0, frames)
        .Select(frame => (float)(.65 * Math.Sin(2 * Math.PI * 997 * (frame + .37) / rate))).ToArray();

    private static void InterleavedStereo(Action<bool, string> check)
    {
        const int rate = 48_000, frames = 480, packets = 1000, channels = 2;
        var source = new float[frames * packets * channels];
        for (var frame = 0; frame < frames * packets; frame++)
        {
            source[frame * channels] = (float)(.65 * Math.Sin(2 * Math.PI * 997 * (frame + .37) / rate));
            source[frame * channels + 1] = (float)(.35 * Math.Sin(2 * Math.PI * 431 * (frame + .61) / rate));
        }
        var planner = new AudioPacketPlanner(rate, false);
        using var output = new MemoryStream();
        for (var packet = 0; packet < packets; packet++)
        {
            double? timestamp = packet == 0 ? 0 : packet % 7 == 0 ? null
                : packet * .01 + (packet % 2 == 0 ? -.006 : .006);
            Append(output, source.AsSpan(packet * frames * channels, frames * channels),
                planner.Plan(1_000_000 + packet * frames, frames, timestamp, (packet + 1) * .01 + .01), channels);
        }
        check(SameSamples(output, source) && planner.WrittenFrames == frames * packets
            && planner.GapFrames == 0 && planner.SkippedFrames == 0,
            "48000 Hz stereo: 1000 packets preserve different left/right sine waves byte for byte in their interleaved order");
    }

    private static void Append(MemoryStream output, ReadOnlySpan<float> packet, AudioPacketPlan plan, int channels = 1)
    {
        if (plan.SilenceFrames < 0 || plan.SkipFrames < 0 || plan.WriteFrames < 0
            || (plan.SkipFrames + plan.WriteFrames) * channels != packet.Length)
            throw new InvalidOperationException("A packet plan must partition whole input frames.");
        output.Write(new byte[checked((int)plan.SilenceFrames * channels * sizeof(float))]);
        output.Write(MemoryMarshal.AsBytes(packet.Slice(plan.SkipFrames * channels, plan.WriteFrames * channels)));
    }

    private static bool SameSamples(MemoryStream output, float[] expected) =>
        output.ToArray().AsSpan().SequenceEqual(MemoryMarshal.AsBytes(expected.AsSpan()));

    private static int LongestZeroRun(MemoryStream output)
    {
        var longest = 0;
        var current = 0;
        foreach (var sample in MemoryMarshal.Cast<byte, float>(output.ToArray().AsSpan()))
        {
            current = sample == 0 ? current + 1 : 0;
            longest = Math.Max(longest, current);
        }
        return longest;
    }
}
