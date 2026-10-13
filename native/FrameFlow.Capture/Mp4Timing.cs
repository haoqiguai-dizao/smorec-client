using System.Buffers.Binary;
using System.Text;

namespace FrameFlow.Capture;

// Reads the single video track written by Media Foundation. Fragment sample timing is
// authoritative: recorder callbacks can include an initial frame the encoder discards.
internal static class Mp4Timing
{
    private readonly record struct Box(string Type, long Start, long End);

    internal static double ReadDuration(string path)
    {
        using var stream = File.OpenRead(path);
        uint timescale = 0;
        uint defaultDuration = 0;
        ulong duration = 0;
        ulong fragmentEnd = 0;
        foreach (var box in Boxes(stream, 0, stream.Length))
        {
            if (box.Type == "moov") ReadMovie(stream, box, ref timescale, ref defaultDuration, ref duration);
            if (box.Type == "moof") fragmentEnd = Math.Max(fragmentEnd, ReadFragment(stream, box, defaultDuration, fragmentEnd));
        }
        duration = Math.Max(duration, fragmentEnd);
        if (timescale == 0 || duration == 0) throw new InvalidDataException("MP4 缺少有效的视频时长。");
        return duration / (double)timescale;
    }

    private static void ReadMovie(Stream stream, Box parent, ref uint timescale, ref uint fallback, ref ulong duration)
    {
        foreach (var box in Boxes(stream, parent.Start, parent.End))
        {
            if (box.Type is "trak" or "mdia" or "mvex") ReadMovie(stream, box, ref timescale, ref fallback, ref duration);
            if (box.Type == "mdhd")
            {
                var version = U32(stream) >> 24;
                stream.Position += version == 1 ? 16 : 8;
                timescale = U32(stream);
                var value = version == 1 ? U64(stream) : U32(stream);
                if (value != uint.MaxValue && value != ulong.MaxValue) duration = Math.Max(duration, value);
            }
            if (box.Type == "trex") { stream.Position += 12; fallback = U32(stream); }
        }
    }

    private static ulong ReadFragment(Stream stream, Box fragment, uint fallback, ulong continuation)
    {
        ulong maximum = 0;
        foreach (var track in Boxes(stream, fragment.Start, fragment.End))
        {
            if (track.Type != "traf") continue;
            ulong start = continuation;
            ulong length = 0;
            var defaultDuration = fallback;
            foreach (var box in Boxes(stream, track.Start, track.End))
            {
                if (box.Type == "tfhd")
                {
                    var flags = U32(stream) & 0xffffff;
                    stream.Position += 4;
                    if ((flags & 1) != 0) stream.Position += 8;
                    if ((flags & 2) != 0) stream.Position += 4;
                    if ((flags & 8) != 0) defaultDuration = U32(stream);
                }
                if (box.Type == "tfdt") start = U32(stream) >> 24 == 1 ? U64(stream) : U32(stream);
                if (box.Type == "trun")
                {
                    var flags = U32(stream) & 0xffffff;
                    var count = U32(stream);
                    if ((flags & 1) != 0) stream.Position += 4;
                    if ((flags & 4) != 0) stream.Position += 4;
                    if (count > 10_000_000) throw new InvalidDataException("MP4 sample count is invalid.");
                    for (uint index = 0; index < count; index++)
                    {
                        length += (flags & 0x100) != 0 ? U32(stream) : defaultDuration;
                        if ((flags & 0x200) != 0) stream.Position += 4;
                        if ((flags & 0x400) != 0) stream.Position += 4;
                        if ((flags & 0x800) != 0) stream.Position += 4;
                    }
                }
            }
            maximum = Math.Max(maximum, start + length);
        }
        return maximum;
    }

    private static IEnumerable<Box> Boxes(Stream stream, long start, long end)
    {
        while (start + 8 <= end)
        {
            stream.Position = start;
            ulong length = U32(stream);
            var typeBytes = new byte[4];
            stream.ReadExactly(typeBytes);
            var type = Encoding.ASCII.GetString(typeBytes);
            if (length == 1) length = U64(stream);
            if (length == 0) length = (ulong)(end - start);
            var body = stream.Position;
            if (length < (ulong)(body - start) || length > (ulong)(end - start))
                throw new InvalidDataException("MP4 box bounds are invalid.");
            var next = start + (long)length;
            yield return new Box(type, body, next);
            start = next;
        }
    }

    private static uint U32(Stream stream)
    {
        Span<byte> bytes = stackalloc byte[4];
        stream.ReadExactly(bytes);
        return BinaryPrimitives.ReadUInt32BigEndian(bytes);
    }
    private static ulong U64(Stream stream)
    {
        Span<byte> bytes = stackalloc byte[8];
        stream.ReadExactly(bytes);
        return BinaryPrimitives.ReadUInt64BigEndian(bytes);
    }
}
