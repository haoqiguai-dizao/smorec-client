using System.Buffers.Binary;

namespace FrameFlow.Capture;

internal enum TypingKeyAction { Ignore, Typing, Reset }
internal readonly record struct InputFocus(nint Foreground, nint Focus)
{
    internal bool Valid => Foreground != 0 && Focus != 0;
}

internal static class RawKeyboardActivity
{
    internal static TypingKeyAction Classify(ushort key, ushort flags, bool shortcutHeld)
    {
        if ((flags & 1) != 0 || key is 0 or 0xff) return TypingKeyAction.Ignore;
        if (shortcutHeld || key is 9 or 17 or 18 or 27 or 91 or 92 or >= 162 and <= 165)
            return TypingKeyAction.Reset;
        if (key is 8 or 13 or 32 or 46 or 229 or 231 || key is >= 48 and <= 57 || key is >= 65 and <= 90
            || key is >= 96 and <= 111 || key is >= 186 and <= 192 || key is >= 219 and <= 226)
            return TypingKeyAction.Typing;
        return key is >= 112 and <= 135 ? TypingKeyAction.Reset : TypingKeyAction.Ignore;
    }

    internal static bool TryClassify(ReadOnlySpan<byte> bytes, int pointerSize, bool shortcutHeld,
        out TypingKeyAction action)
    {
        action = TypingKeyAction.Ignore;
        if (pointerSize is not (4 or 8)) return false;
        var headerSize = 8 + pointerSize * 2;
        if (bytes.Length < headerSize + 16 || BinaryPrimitives.ReadUInt32LittleEndian(bytes) != 1
            || BinaryPrimitives.ReadUInt32LittleEndian(bytes[4..]) != bytes.Length) return false;
        var flags = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(headerSize + 2)..]);
        var key = BinaryPrimitives.ReadUInt16LittleEndian(bytes[(headerSize + 6)..]);
        action = Classify(key, flags, shortcutHeld);
        return true;
    }
}

internal sealed class TypingActivityState(Action<InputActivitySample> emit)
{
    private InputFocus anchor;
    private (double Time, InputFocus Focus)? pendingFocusReset;
    private double anchoredAt;
    private double invalidatedAt = double.NegativeInfinity;
    private double lastTyping = double.NegativeInfinity;

    internal void Click(double time, InputFocus trustedFocus)
    {
        if (pendingFocusReset is { } pending && trustedFocus.Valid && trustedFocus == pending.Focus && time <= pending.Time)
            pendingFocusReset = null;
        else FlushFocusReset(double.PositiveInfinity);
        var mayAnchor = time >= invalidatedAt;
        Reset(time, always: true);
        anchor = mayAnchor ? trustedFocus : default;
        anchoredAt = time;
    }

    internal void CheckFocus(double time, InputFocus current)
    {
        if (anchor.Valid && current != anchor)
        {
            // Gate typing immediately, but let a delayed mouse click identify this same focus transition.
            anchor = default;
            lastTyping = double.NegativeInfinity;
            pendingFocusReset = (time, current);
        }
        FlushFocusReset(time);
    }

    internal void FlushFocusReset(double time)
    {
        if (pendingFocusReset is not { } pending || time - pending.Time <= .2) return;
        pendingFocusReset = null;
        invalidatedAt = Math.Max(invalidatedAt, pending.Time);
        Publish(pending.Time, "reset");
    }

    internal void Key(double time, TypingKeyAction action, InputFocus current, InputActivityFocus? position = null)
    {
        CheckFocus(time, current);
        if (action == TypingKeyAction.Reset) { Reset(time); return; }
        if (action != TypingKeyAction.Typing) return;
        if (position is not null && TypingFocusGeometry.Valid(position) && current.Valid && time >= invalidatedAt)
        {
            // A verified caret/editor can establish focus after Tab or programmatic autofocus.
            if (current != anchor)
            {
                FlushFocusReset(double.PositiveInfinity);
                anchoredAt = time;
            }
            anchor = current;
        }
        else position = null;
        if (!anchor.Valid || current != anchor || time < anchoredAt) return;
        if (time - lastTyping < .1) return;
        lastTyping = time;
        Publish(time, "typing", position);
    }

    internal void Reset(double time, bool always = false)
    {
        FlushFocusReset(double.PositiveInfinity);
        var hadAnchor = anchor.Valid;
        anchor = default;
        invalidatedAt = Math.Max(invalidatedAt, time);
        // A new click target must retain its first key even within the prior target's throttle window.
        lastTyping = double.NegativeInfinity;
        if (hadAnchor || always) Publish(time, "reset");
    }

    private void Publish(double time, string kind, InputActivityFocus? position = null)
    {
        if (!double.IsFinite(time) || time < 0) return;
        emit(new InputActivitySample(time, kind, position));
    }
}
