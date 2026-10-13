using System.Buffers.Binary;

namespace FrameFlow.Capture;

internal readonly record struct RawMousePacket(nuint Device, ushort ButtonFlags)
{
    internal const ushort DownFlags = 0x0155;
    internal int DownCount => System.Numerics.BitOperations.PopCount((uint)(ButtonFlags & DownFlags));

    internal static bool TryParse(ReadOnlySpan<byte> data, int pointerSize, out RawMousePacket packet)
    {
        packet = default;
        if (pointerSize is not (4 or 8)) return false;
        var headerSize = 8 + pointerSize * 2;
        if (data.Length < headerSize + 24) return false;
        var size = BinaryPrimitives.ReadUInt32LittleEndian(data[4..]);
        if (BinaryPrimitives.ReadUInt32LittleEndian(data) != 0 || size < headerSize + 24 || size > data.Length)
            return false;
        var device = pointerSize == 8
            ? unchecked((nuint)BinaryPrimitives.ReadUInt64LittleEndian(data[8..]))
            : BinaryPrimitives.ReadUInt32LittleEndian(data[8..]);
        packet = new RawMousePacket(device, BinaryPrimitives.ReadUInt16LittleEndian(data[(headerSize + 4)..]));
        return true;
    }
}

internal sealed class PollButtonTransitions(ushort initialMask)
{
    private ushort previous = initialMask;

    internal ushort Update(ushort downMask)
    {
        var pressed = (ushort)(downMask & ~previous);
        previous = downMask;
        return pressed;
    }
}

internal readonly record struct CursorClick(double Time, Win32.Point Point);

// One input thread produces; the cursor journal thread consumes. Neither waits on the other.
internal sealed class BoundedMouseClickQueue
{
    private readonly CursorClick[] items;
    private readonly int mask;
    private int read;
    private int write;

    internal BoundedMouseClickQueue(int capacityPowerOfTwo = 1024)
    {
        if (capacityPowerOfTwo < 2 || (capacityPowerOfTwo & (capacityPowerOfTwo - 1)) != 0)
            throw new ArgumentOutOfRangeException(nameof(capacityPowerOfTwo));
        items = new CursorClick[capacityPowerOfTwo];
        mask = capacityPowerOfTwo - 1;
    }

    internal bool TryEnqueue(CursorClick click)
    {
        var next = (write + 1) & mask;
        if (next == Volatile.Read(ref read)) return false;
        items[write] = click;
        Volatile.Write(ref write, next);
        return true;
    }

    internal bool TryDequeue(out CursorClick click)
    {
        if (read == Volatile.Read(ref write)) { click = default; return false; }
        click = items[read];
        Volatile.Write(ref read, (read + 1) & mask);
        return true;
    }
}
