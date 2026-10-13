namespace FrameFlow.Capture;

// The capture thread still writes every sample; muting only replaces the PCM payload.
internal sealed class AudioMuteGate
{
    private int muted;
    internal bool Muted => Volatile.Read(ref muted) != 0;
    internal void Set(bool value) => Interlocked.Exchange(ref muted, value ? 1 : 0);
    internal void Apply(byte[] buffer, int offset, int count)
    {
        if (Muted) Array.Clear(buffer, offset, count);
    }
}
