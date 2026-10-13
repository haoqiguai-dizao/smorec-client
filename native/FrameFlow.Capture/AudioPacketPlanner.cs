namespace FrameFlow.Capture;

internal readonly record struct AudioPacketPlan(long SilenceFrames, int SkipFrames, int WriteFrames);

/// <summary>
/// Device positions describe sample continuity; QPC anchors the stream on the video clock.
/// Packet-level timestamp jitter must never splice otherwise continuous PCM.
/// </summary>
internal sealed class AudioPacketPlanner(int sampleRate, bool loopback)
{
    private bool started;
    private long previousPosition;
    private long expectedPosition;
    private double previousArrival;
    internal long WrittenFrames { get; private set; }
    internal long LeadingFrames { get; private set; }
    internal long GapFrames { get; private set; }
    internal long SkippedFrames { get; private set; }
    internal long Discontinuities { get; private set; }
    internal long TimestampErrors { get; private set; }
    internal long Resets { get; private set; }
    internal long TimestampGapResyncs { get; private set; }
    internal double MaximumTimestampDriftMs { get; private set; }

    internal AudioPacketPlan Plan(long devicePosition, int frames, double? timestampSeconds,
        double nowSeconds, bool discontinuity = false)
    {
        if (sampleRate <= 0 || frames < 0 || devicePosition < 0 || !double.IsFinite(nowSeconds))
            throw new ArgumentOutOfRangeException(nameof(frames), "Invalid audio packet timing.");
        if (frames == 0) return default;
        var timestamp = timestampSeconds is { } t && double.IsFinite(t) && t >= 0 ? t : (double?)null;
        if (timestamp is null) TimestampErrors++;
        if (discontinuity) Discontinuities++;
        long target;
        var first = !started;
        if (first)
        {
            // An uncertain first packet needs one approximate anchor, never a new one per packet.
            target = FramesAt(timestamp ?? Math.Max(0, nowSeconds - frames / (double)sampleRate));
            started = true;
        }
        else if (devicePosition < previousPosition)
        {
            Resets++;
            target = WrittenFrames;
            // A device counter restart loses its mapping. Preserve a real forward gap,
            // but never discard captured PCM because of a slightly earlier QPC timestamp.
            if (timestamp is { } resetTime && resetTime - WrittenFrames / (double)sampleRate > .05)
            {
                target = Math.Max(WrittenFrames, FramesAt(resetTime));
                TimestampGapResyncs++;
            }
        }
        else
        {
            var delta = checked(devicePosition - expectedPosition);
            target = Math.Max(0, checked(WrittenFrames + delta));
            // Some loopback devices pause their frame counter while no sound is playing.
            // Require both a packet arrival gap and a trustworthy timeline gap; ordinary
            // +/-6ms Bluetooth timestamp jitter or draining a backlog cannot trigger this.
            if (delta >= 0 && (loopback || discontinuity) && timestamp is { } resumedTime
                && resumedTime - target / (double)sampleRate > .05
                && nowSeconds - previousArrival - frames / (double)sampleRate > .05)
            {
                target = Math.Max(target, FramesAt(resumedTime));
                TimestampGapResyncs++;
            }
        }

        if (timestamp is { } sampleTime)
            MaximumTimestampDriftMs = Math.Max(MaximumTimestampDriftMs, Math.Abs(sampleTime - target / (double)sampleRate) * 1000);
        var silence = Math.Max(0, target - WrittenFrames);
        var skip = (int)Math.Min(frames, Math.Max(0, WrittenFrames - target));
        if (first) LeadingFrames += silence; else GapFrames += silence;
        SkippedFrames += skip;
        WrittenFrames = checked(WrittenFrames + silence + frames - skip);
        var packetEnd = checked(devicePosition + frames);
        expectedPosition = first || devicePosition < previousPosition ? packetEnd : Math.Max(expectedPosition, packetEnd);
        previousPosition = devicePosition;
        previousArrival = nowSeconds;
        return new AudioPacketPlan(silence, skip, frames - skip);
    }

    private long FramesAt(double seconds) => checked((long)Math.Round(Math.Max(0, seconds) * sampleRate, MidpointRounding.AwayFromZero));
}
