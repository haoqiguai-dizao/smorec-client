using System.Buffers.Binary;
using System.Reflection;
using System.Runtime.InteropServices;
using FrameFlow.Capture;

internal static class RawMousePacketTests
{
    internal static void Run(Action<bool, string> check)
    {
        foreach (var pointerSize in new[] { 4, 8 }) TestLayout(pointerSize, check);
        TestButtons(check);
        TestPoll(check);
        TestQueue(check);
        var imports = new[] { typeof(Win32), typeof(RawInputWin32) }
            .SelectMany(type => type.GetMethods(BindingFlags.NonPublic | BindingFlags.Static))
            .Select(method => method.GetCustomAttribute<DllImportAttribute>()?.EntryPoint).ToArray();
        check(!imports.Any(name => name?.Contains("WindowsHook", StringComparison.Ordinal) == true
            || name?.Contains("CallNextHook", StringComparison.Ordinal) == true),
            "mouse interop has no synchronous global hook imports");
        check(Marshal.SizeOf<RawInputWin32.Header>() == 8 + 2 * IntPtr.Size
            && Marshal.SizeOf<RawInputWin32.Mouse>() == 24
            && Marshal.OffsetOf<RawInputWin32.Mouse>(nameof(RawInputWin32.Mouse.Buttons)) == 4,
            "native mouse layout matches the parser header and button union offsets");
    }

    private static void TestLayout(int pointerSize, Action<bool, string> check)
    {
        var device = pointerSize == 8 ? 0xfedcba9876543210UL : 0xfedcba98UL;
        var bytes = Packet(pointerSize, device, 0x0155);
        check(RawMousePacket.TryParse(bytes, pointerSize, out var parsed)
            && parsed.Device == unchecked((nuint)device) && parsed.DownCount == 5,
            $"raw {pointerSize * 8}-bit header preserves device identity and all five buttons");
        var unaligned = new byte[bytes.Length + 3];
        bytes.CopyTo(unaligned, 1);
        check(RawMousePacket.TryParse(unaligned.AsSpan(1, bytes.Length), pointerSize, out var shifted)
            && shifted == parsed, $"raw {pointerSize * 8}-bit parser accepts unaligned spans");
        check(Enumerable.Range(0, bytes.Length).All(length => !RawMousePacket.TryParse(bytes.AsSpan(0, length), pointerSize, out _)),
            $"raw {pointerSize * 8}-bit parser rejects every truncated byte boundary");
        var invalidSize = bytes.ToArray();
        BinaryPrimitives.WriteUInt32LittleEndian(invalidSize.AsSpan(4), (uint)(bytes.Length - 1));
        check(!RawMousePacket.TryParse(invalidSize, pointerSize, out _), "raw rejects a declared size shorter than RAWMOUSE");
        BinaryPrimitives.WriteUInt32LittleEndian(invalidSize.AsSpan(4), (uint)(bytes.Length + 1));
        check(!RawMousePacket.TryParse(invalidSize, pointerSize, out _), "raw rejects declared bytes outside the provided span");
        BinaryPrimitives.WriteUInt32LittleEndian(invalidSize.AsSpan(4), uint.MaxValue);
        check(!RawMousePacket.TryParse(invalidSize, pointerSize, out _), "raw size arithmetic does not overflow");
        var extended = bytes.Concat(new byte[] { 0xff, 0xff, 0xff }).ToArray();
        check(RawMousePacket.TryParse(extended, pointerSize, out var trailing) && trailing == parsed,
            "raw ignores bytes beyond the declared packet size");
        BinaryPrimitives.WriteUInt32LittleEndian(extended.AsSpan(4), (uint)extended.Length);
        check(RawMousePacket.TryParse(extended, pointerSize, out var extension) && extension == parsed,
            "raw accepts a larger valid packet without reading extra button flags");
        foreach (var type in new uint[] { 1, 2, uint.MaxValue })
        {
            var other = bytes.ToArray();
            BinaryPrimitives.WriteUInt32LittleEndian(other, type);
            check(!RawMousePacket.TryParse(other, pointerSize, out _), "raw rejects non-mouse packet types");
        }
        check(RawMousePacket.TryParse(Packet(pointerSize, 0, 1), pointerSize, out var zero) && zero.Device == 0 && zero.DownCount == 1,
            "raw accepts a zero device handle, including the documented precision-touchpad case");
        check(new[] { -1, 0, 1, 2, 16, int.MaxValue }.All(size => !RawMousePacket.TryParse(bytes, size, out _)),
            "raw rejects unsupported pointer widths");
    }

    private static void TestButtons(Action<bool, string> check)
    {
        foreach (ushort down in new ushort[] { 1, 4, 16, 64, 256 })
        {
            ushort up = (ushort)(down << 1);
            var flags = new ushort[] { down, up, down, up, down, down, up, up, down };
            var packets = flags.Select(flag => Packet(8, 7, flag)).ToArray();
            var counts = packets.Select(bytes => RawMousePacket.TryParse(bytes, 8, out var packet) ? packet.DownCount : -1).ToArray();
            check(counts.SequenceEqual(new[] { 1, 0, 1, 0, 1, 1, 0, 0, 1 }),
                $"raw button {down} preserves rapid down/up and repeated down without a time-window filter");
            check(new RawMousePacket(7, (ushort)(down | up)).DownCount == 1,
                "raw same-packet down/up retains the down transition");
        }
        check(new ushort[] { 0, 0x02aa, 0x0400, 0x0800, 0xf000 }.All(flags => new RawMousePacket(9, flags).DownCount == 0),
            "raw movement, releases, wheel and reserved flags produce no click");
        var devices = new[] { new RawMousePacket(1, 1), new RawMousePacket(2, 1), new RawMousePacket(0, 1),
            new RawMousePacket(1, 2), new RawMousePacket(2, 1), new RawMousePacket(1, 1) };
        check(devices.Sum(packet => packet.DownCount) == 5,
            "raw interleaved devices and release/down ordering never suppress another device's press");
        check(new RawMousePacket(1, ushort.MaxValue).DownCount == 5,
            "raw counts only five documented down bits even with every flag set");
    }

    private static void TestPoll(Action<bool, string> check)
    {
        var poll = new PollButtonTransitions(0x1f);
        check(poll.Update(0x1f) == 0 && poll.Update(0) == 0 && poll.Update(0x1f) == 0x1f,
            "poll initializes held buttons without false startup clicks and detects the next press");
        check(poll.Update(0x1f) == 0 && poll.Update(0x15) == 0 && poll.Update(0x1f) == 0x0a,
            "poll suppresses unchanged state and returns only newly pressed buttons");
        foreach (ushort button in new ushort[] { 1, 2, 4, 8, 16 })
        {
            poll = new PollButtonTransitions(0);
            check(poll.Update(button) == button && poll.Update(0) == 0 && poll.Update(button) == button,
                $"poll button {button} preserves separately observed presses");
        }
        check(new PollButtonTransitions(0).Update(0) == 0,
            "poll does not invent a down/up that happened entirely between samples");
    }

    private static void TestQueue(Action<bool, string> check)
    {
        foreach (var capacity in new[] { 0, 1, 3, -2 })
            check(Throws<ArgumentOutOfRangeException>(() => new BoundedMouseClickQueue(capacity)), "click queue requires a power-of-two capacity of at least two");
        var queue = new BoundedMouseClickQueue(4);
        var clicks = new[] { Click(2), Click(1), Click(1), Click(0) };
        check(queue.TryEnqueue(clicks[0]) && queue.TryEnqueue(clicks[1]) && queue.TryEnqueue(clicks[2])
            && !queue.TryEnqueue(clicks[3]), "click queue has a bounded capacity and reports overflow");
        check(queue.TryDequeue(out var first) && first == clicks[0] && queue.TryEnqueue(clicks[3]),
            "click queue resumes after capacity is released");
        var remaining = new List<CursorClick>();
        while (queue.TryDequeue(out var click)) remaining.Add(click);
        check(remaining.SequenceEqual(clicks.Skip(1)) && !queue.TryDequeue(out _),
            "click queue keeps duplicate clicks and arrival order rather than sorting timestamps");
        for (var i = 0; i < 1000; i++)
            if (!queue.TryEnqueue(Click(i)) || !queue.TryDequeue(out var click) || click.Time != i)
                throw new InvalidOperationException("click queue wraparound changed a click");
        check(true, "click queue remains correct across ring-buffer wraparound");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        const int count = 20_000;
        var writer = Task.Run(() =>
        {
            for (var i = 0; i < count; i++)
                while (!queue.TryEnqueue(Click(i))) { timeout.Token.ThrowIfCancellationRequested(); Thread.Yield(); }
        });
        for (var i = 0; i < count; i++)
        {
            CursorClick click;
            while (!queue.TryDequeue(out click)) { timeout.Token.ThrowIfCancellationRequested(); Thread.Yield(); }
            if (click.Time != i) throw new InvalidOperationException("SPSC queue lost or reordered an event");
        }
        writer.GetAwaiter().GetResult();
        check(!queue.TryDequeue(out _), "click queue preserves every event across independent producer/consumer threads");
    }

    private static CursorClick Click(double time) => new(time, new Win32.Point { X = 13, Y = 27 });
    internal static bool Throws<T>(Action action) where T : Exception
    {
        try { action(); return false; } catch (T) { return true; }
    }
    private static byte[] Packet(int pointerSize, ulong device, ushort flags)
    {
        var headerSize = 8 + pointerSize * 2;
        var bytes = new byte[headerSize + 24];
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), (uint)bytes.Length);
        if (pointerSize == 8) BinaryPrimitives.WriteUInt64LittleEndian(bytes.AsSpan(8), device);
        else BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(8), (uint)device);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(headerSize + 4), flags);
        return bytes;
    }
}
