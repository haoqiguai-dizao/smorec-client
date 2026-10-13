using System.Buffers.Binary;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using ScreenRecorderLib;

namespace FrameFlow.Capture;

// One latest frame and one transport buffer. The consumer requests each frame explicitly.
internal sealed class LiveFrameServer : IAsyncDisposable
{
    private readonly NamedPipeServerStream pipe;
    private readonly CancellationTokenSource stopped = new();
    private readonly object gate = new();
    private readonly TaskCompletionSource first = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Action<Exception> failed;
    private readonly int width, height;
    private readonly byte[] latest, sending;
    private Task? serving;
    private readonly Func<double> now;
    private readonly Func<LiveAudioPacket>? audio;
    private int generation;
    internal int Generation { get { lock (gate) return generation; } }
    internal void BeginUpdate()
    {
        lock (gate) { generation++; Array.Clear(latest); }
    }

    internal LiveFrameServer(string name, int width, int height, Action<Exception> failed, Func<double> now, Func<LiveAudioPacket>? audio = null)
    {
        if (!name.StartsWith("xiaolu-live-", StringComparison.Ordinal) || name.Length != 48
            || !Guid.TryParseExact(name[12..], "D", out _)) throw new ArgumentException("直播媒体通道无效。");
        this.width = width; this.height = height; this.failed = failed; this.now = now; this.audio = audio;
        latest = new byte[checked(width * height * 4)]; sending = new byte[latest.Length];
        pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly, 4096, 65536);
    }

    internal void Start() => serving = Task.Run(Serve);

    internal bool Publish(FrameBitmapData? bitmap, int producerGeneration)
    {
        if (stopped.IsCancellationRequested || bitmap is null || bitmap.Data == 0) return false;
        if (bitmap.Width != width || bitmap.Height != height || bitmap.Stride < width * 4
            || bitmap.Length < (long)bitmap.Stride * height) return false;
        lock (gate)
        {
            if (producerGeneration != generation) return false;
            if (bitmap.Stride == width * 4) Marshal.Copy(bitmap.Data, latest, 0, latest.Length);
            else for (var y = 0; y < height; y++) Marshal.Copy(bitmap.Data + y * bitmap.Stride, latest, y * width * 4, width * 4);
        }
        first.TrySetResult();
        return true;
    }

    private async Task Serve()
    {
        try
        {
            await pipe.WaitForConnectionAsync(stopped.Token);
            await first.Task.WaitAsync(stopped.Token);
            var request = new byte[1]; var header = new byte[24];
            BinaryPrimitives.WriteUInt32LittleEndian(header, 0x584c4652);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(4), width);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(8), height);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(12), latest.Length);
            while (await pipe.ReadAsync(request, stopped.Token) == 1)
            {
                if (request[0] != 1) throw new IOException("直播帧请求无效。");
                lock (gate)
                {
                    Buffer.BlockCopy(latest, 0, sending, 0, latest.Length);
                    BinaryPrimitives.WriteDoubleLittleEndian(header.AsSpan(16), now());
                }
                var packet = audio?.Invoke();
                await pipe.WriteAsync(header, stopped.Token);
                await pipe.WriteAsync(sending, stopped.Token);
                if (packet is not null)
                {
                    var audioHeader = new byte[16];
                    BinaryPrimitives.WriteUInt32LittleEndian(audioHeader, 0x584c4155);
                    BinaryPrimitives.WriteInt32LittleEndian(audioHeader.AsSpan(4), packet.Data.Length);
                    BinaryPrimitives.WriteDoubleLittleEndian(audioHeader.AsSpan(8), packet.Time);
                    await pipe.WriteAsync(audioHeader, stopped.Token);
                    await pipe.WriteAsync(packet.Data, stopped.Token);
                }
            }
        }
        catch (Exception ex) when (ex is OperationCanceledException or ObjectDisposedException) { }
        catch (Exception ex) { if (!stopped.IsCancellationRequested) failed(ex); }
    }

    public async ValueTask DisposeAsync()
    {
        stopped.Cancel(); pipe.Dispose();
        if (serving is not null) await serving;
        stopped.Dispose();
    }
}
