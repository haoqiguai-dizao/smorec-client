using System.ComponentModel;
using System.Runtime.InteropServices;

namespace FrameFlow.Capture;

internal sealed class RawMouseInputCollector : IDisposable
{
    private static RawMouseInputCollector? rawOwner;
    private static readonly uint InputSize = (uint)Marshal.SizeOf<RawInputWin32.Input>();
    private static readonly uint HeaderSize = (uint)Marshal.SizeOf<RawInputWin32.Header>();
    private readonly CaptureClock clock;
    private readonly string backend;
    private readonly BoundedMouseClickQueue clicks = new();
    private readonly TaskCompletionSource<bool> ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly ManualResetEventSlim stopping = new(false);
    private readonly object lifecycle = new();
    private readonly RawInputWin32.WindowCallback callback;
    private readonly string className = $"FrameFlow.Mouse.{Guid.NewGuid():N}";
    private Thread? thread;
    private int stopRequested;
    private uint threadId;
    private Exception? error;
    private string? warning;
    private nint window;
    private long inputCount, buttonCount, queuedCount, overflowCount, parseErrorCount, zeroDeviceCount;
    private long positionUnavailableCount;
    private long messageAgeSampleCount, messageAgeOver50MsCount, messageAgeInvalidCount;
    private uint messageAgeMaxMs;
    private int firstPositionError;
    private uint registeredFlags;
    private long registeredWindow;
    private bool registered, registrationVerified, registrationRemoved, disposed;

    internal RawMouseInputCollector(CaptureClock clock, string backend)
    {
        if (backend is not ("raw" or "poll")) throw new ArgumentOutOfRangeException(nameof(backend));
        this.clock = clock;
        this.backend = backend;
        callback = WindowProcedure;
    }

    internal Exception? Error => Volatile.Read(ref error);
    internal string? Warning => Volatile.Read(ref warning);
    internal bool ThreadExited => thread is null || !thread.IsAlive;
    internal bool TryDequeue(out CursorClick click) => clicks.TryDequeue(out click);

    internal void Start(CancellationToken cancellation = default)
    {
        lock (lifecycle)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (thread is not null) throw new InvalidOperationException("Mouse input is already started.");
            if (Volatile.Read(ref stopRequested) != 0) throw new OperationCanceledException("Mouse input has been stopped.");
            cancellation.ThrowIfCancellationRequested();
            if (backend == "raw" && Interlocked.CompareExchange(ref rawOwner, this, null) is not null)
                throw new InvalidOperationException("Another mouse input collector is still active.");
            try
            {
                thread = new Thread(Run) { IsBackground = true, Name = $"FrameFlow mouse {backend}" };
                thread.Start();
            }
            catch
            {
                Interlocked.CompareExchange(ref rawOwner, null, this);
                thread = null;
                throw;
            }
        }
        try
        {
            ready.Task.WaitAsync(TimeSpan.FromSeconds(3), cancellation).GetAwaiter().GetResult();
            cancellation.ThrowIfCancellationRequested();
            if (Volatile.Read(ref stopRequested) != 0) throw new OperationCanceledException("Mouse input has been stopped.");
            if (Error is { } failure) throw failure;
        }
        catch { Stop(); throw; }
    }

    private void Run()
    {
        try
        {
            Win32.PeekMessage(out _, 0, 0, 0, 0);
            Volatile.Write(ref threadId, Win32.GetCurrentThreadId());
            if (stopping.IsSet || Volatile.Read(ref stopRequested) != 0) return;
            if (backend == "poll") RunPoll();
            else RunRaw();
        }
        catch (Exception ex) { SetError(ex); }
        finally
        {
            if (!stopping.IsSet && Volatile.Read(ref stopRequested) == 0 && Error is null)
                SetError(new InvalidOperationException("Mouse input ended unexpectedly; click markers are unavailable."));
            lock (lifecycle) Volatile.Write(ref threadId, 0);
            Interlocked.CompareExchange(ref rawOwner, null, this);
            ready.TrySetResult(true);
        }
    }

    private void RunRaw()
    {
        var instance = Win32.GetModuleHandle(null);
        var windowClass = new RawInputWin32.WindowClass
        {
            Size = (uint)Marshal.SizeOf<RawInputWin32.WindowClass>(), Instance = instance,
            ClassName = className, Procedure = Marshal.GetFunctionPointerForDelegate(callback)
        };
        if (RawInputWin32.RegisterClassEx(ref windowClass) == 0) throw NativeError("Register mouse window class");
        try
        {
            if (stopping.IsSet) return;
            window = RawInputWin32.CreateWindowEx(0, className, "", 0, 0, 0, 0, 0, (nint)(-3), 0, instance, 0);
            if (window == 0) throw NativeError("Create mouse input window");
            if (stopping.IsSet) return;
            var device = new RawInputWin32.Device { UsagePage = 1, Usage = 2, Flags = RawInputWin32.InputSink, Target = window };
            if (!RawInputWin32.RegisterRawInputDevices([device], 1, (uint)Marshal.SizeOf<RawInputWin32.Device>()))
                throw NativeError("Register asynchronous mouse input");
            registered = true;
            // Cancellation may race the native registration; never publish or retain that late registration.
            if (stopping.IsSet) return;
            VerifyRegistration();
            ready.TrySetResult(true);
            while (!stopping.IsSet)
            {
                var result = Win32.GetMessage(out var message, 0, 0, 0);
                if (result == 0) break;
                if (result < 0) throw NativeError("Read mouse input messages");
                try
                {
                    if (message.Id == RawInputWin32.InputMessage && message.Hwnd == window && Error is null)
                        ReadRawInput(message.LParam, message.Position, message.Time);
                }
                finally { Win32.DispatchMessage(ref message); }
            }
        }
        finally
        {
            if (registered)
            {
                var remove = new RawInputWin32.Device { UsagePage = 1, Usage = 2, Flags = RawInputWin32.Remove };
                if (!RawInputWin32.RegisterRawInputDevices([remove], 1, (uint)Marshal.SizeOf<RawInputWin32.Device>()))
                    SetError(NativeError("Remove mouse input registration"));
                else
                {
                    try
                    {
                        registrationRemoved = !ReadRegistrations().Any(device => device.UsagePage == 1 && device.Usage == 2);
                        if (!registrationRemoved) SetError(new InvalidOperationException("Mouse registration remains after removal."));
                    }
                    catch (Exception ex) { SetError(ex); }
                }
                registered = false;
            }
            if (window != 0)
            {
                if (!RawInputWin32.DestroyWindow(window)) SetError(NativeError("Destroy mouse input window"));
                window = 0;
            }
            if (!RawInputWin32.UnregisterClass(className, instance)) SetError(NativeError("Unregister mouse window class"));
            GC.KeepAlive(callback);
        }
    }

    private void VerifyRegistration()
    {
        foreach (var device in ReadRegistrations())
        {
            if (device.UsagePage != 1 || device.Usage != 2 || device.Target != window) continue;
            registeredFlags = device.Flags;
            registeredWindow = (long)device.Target;
            registrationVerified = device.Flags == RawInputWin32.InputSink;
        }
        if (!registrationVerified) throw new InvalidOperationException("Mouse input registration could not be verified.");
    }

    private static RawInputWin32.Device[] ReadRegistrations()
    {
        uint count = 0;
        var size = (uint)Marshal.SizeOf<RawInputWin32.Device>();
        if (RawInputWin32.GetRegisteredRawInputDevices(null, ref count, size) == uint.MaxValue)
            throw NativeError("Inspect mouse input registration");
        if (count == 0) return [];
        var devices = new RawInputWin32.Device[count];
        if (RawInputWin32.GetRegisteredRawInputDevices(devices, ref count, size) == uint.MaxValue)
            throw NativeError("Read mouse input registration");
        return devices;
    }

    private nint WindowProcedure(nint handle, uint message, nuint wParam, nint lParam)
    {
        // DefWindowProc performs the required foreground WM_INPUT cleanup as well.
        return RawInputWin32.DefWindowProc(handle, message, wParam, lParam);
    }

    private void ReadRawInput(nint handle, Win32.Point point, uint messageTime)
    {
        inputCount++;
        var age = unchecked((uint)Environment.TickCount - messageTime);
        if (age > int.MaxValue) messageAgeInvalidCount++;
        else
        {
            messageAgeSampleCount++;
            messageAgeMaxMs = Math.Max(messageAgeMaxMs, age);
            if (age > 50) messageAgeOver50MsCount++;
        }
        var input = default(RawInputWin32.Input);
        var size = InputSize;
        var result = RawInputWin32.GetRawInputData(handle, RawInputWin32.ReadInput, ref input, ref size,
            HeaderSize);
        if (result == uint.MaxValue) { parseErrorCount++; throw NativeError("Read raw mouse packet"); }
        var bytes = MemoryMarshal.AsBytes(MemoryMarshal.CreateReadOnlySpan(ref input, 1));
        if (result > bytes.Length || !RawMousePacket.TryParse(bytes[..(int)result], IntPtr.Size, out var packet))
        {
            parseErrorCount++;
            throw new InvalidOperationException("Invalid raw mouse packet.");
        }
        if (packet.Device == 0) zeroDeviceCount++;
        if (packet.DownCount == 0) return;
        QueueClicks(packet.DownCount, point);
    }

    private void RunPoll()
    {
        var transitions = new PollButtonTransitions(ReadButtons());
        ready.TrySetResult(true);
        while (!stopping.Wait(TimeSpan.FromMilliseconds(8)))
        {
            inputCount++;
            var pressed = transitions.Update(ReadButtons());
            if (pressed != 0) QueuePolledClicks(System.Numerics.BitOperations.PopCount((uint)pressed));
        }
    }

    private static ushort ReadButtons()
    {
        ushort result = 0;
        if ((RawInputWin32.GetAsyncKeyState(1) & 0x8000) != 0) result |= 1;
        if ((RawInputWin32.GetAsyncKeyState(2) & 0x8000) != 0) result |= 2;
        if ((RawInputWin32.GetAsyncKeyState(4) & 0x8000) != 0) result |= 4;
        if ((RawInputWin32.GetAsyncKeyState(5) & 0x8000) != 0) result |= 8;
        if ((RawInputWin32.GetAsyncKeyState(6) & 0x8000) != 0) result |= 16;
        return result;
    }

    private void QueuePolledClicks(int count)
    {
        if (!RawInputWin32.GetCursorPos(out var point))
        {
            buttonCount += count;
            if (positionUnavailableCount == 0) firstPositionError = Marshal.GetLastWin32Error();
            positionUnavailableCount += count;
            SetWarning("Mouse click coordinates were unavailable; affected click markers were skipped.");
            return;
        }
        QueueClicks(count, point);
    }

    private void QueueClicks(int count, Win32.Point point)
    {
        buttonCount += count;
        var click = new CursorClick(clock.Seconds, point);
        for (var i = 0; i < count; i++)
        {
            if (clicks.TryEnqueue(click)) queuedCount++;
            else
            {
                overflowCount++;
                SetWarning("Mouse click buffer overflowed; affected click markers were skipped.");
            }
        }
    }

    private void SetWarning(string message) => Interlocked.CompareExchange(ref warning, message, null);

    private void SetError(Exception exception)
    {
        if (Interlocked.CompareExchange(ref error, exception, null) is not null) return;
        var id = Volatile.Read(ref threadId);
        if (id != 0) Win32.PostThreadMessage(id, 0x0012, 0, 0);
    }
    private static Win32Exception NativeError(string operation) => new(Marshal.GetLastWin32Error(), operation);

    internal bool Stop()
    {
        Thread? active;
        lock (lifecycle)
        {
            Interlocked.Exchange(ref stopRequested, 1);
            active = thread;
            if (active is null || !active.IsAlive) return true;
            stopping.Set();
            var id = Volatile.Read(ref threadId);
            if (id != 0) Win32.PostThreadMessage(id, 0x0012, 0, 0);
        }
        return active.Join(TimeSpan.FromSeconds(2));
    }

    internal MouseInputSnapshot Snapshot() => new()
    {
        Backend = backend, InputThreadExited = ThreadExited,
        RegistrationVerified = registrationVerified, RegisteredFlags = registeredFlags,
        RegisteredWindow = registeredWindow, RegistrationRemoved = registrationRemoved,
        InputCount = Interlocked.Read(ref inputCount), ButtonCount = Interlocked.Read(ref buttonCount),
        QueuedCount = Interlocked.Read(ref queuedCount), OverflowCount = Interlocked.Read(ref overflowCount),
        ParseErrorCount = Interlocked.Read(ref parseErrorCount), ZeroDeviceCount = Interlocked.Read(ref zeroDeviceCount),
        PositionUnavailableCount = Interlocked.Read(ref positionUnavailableCount), FirstPositionError = firstPositionError,
        DropCount = Interlocked.Read(ref overflowCount) + Interlocked.Read(ref positionUnavailableCount),
        MessageAgeSampleCount = Interlocked.Read(ref messageAgeSampleCount), MessageAgeMaxMs = messageAgeMaxMs,
        MessageAgeOver50MsCount = Interlocked.Read(ref messageAgeOver50MsCount),
        MessageAgeInvalidCount = Interlocked.Read(ref messageAgeInvalidCount),
        Error = Error?.Message, Warning = Warning
    };

    public void Dispose()
    {
        lock (lifecycle)
        {
            if (disposed) return;
            disposed = true;
        }
        // A delayed thread owns its window and delegate until its finally block completes.
        if (!Stop()) return;
        lock (lifecycle) stopping.Dispose();
    }
}

internal sealed record MouseInputSnapshot
{
    public string Backend { get; init; } = "";
    public bool HookEnabled => false;
    public bool InputThreadExited { get; init; }
    public bool RegistrationVerified { get; init; }
    public uint RegisteredFlags { get; init; }
    public long RegisteredWindow { get; init; }
    public bool RegistrationRemoved { get; init; }
    public long InputCount { get; init; }
    public long ButtonCount { get; init; }
    public long QueuedCount { get; init; }
    public long OverflowCount { get; init; }
    public long ParseErrorCount { get; init; }
    public long ZeroDeviceCount { get; init; }
    public long PositionUnavailableCount { get; init; }
    public int FirstPositionError { get; init; }
    public long DropCount { get; init; }
    public long MessageAgeSampleCount { get; init; }
    public uint MessageAgeMaxMs { get; init; }
    public long MessageAgeOver50MsCount { get; init; }
    public long MessageAgeInvalidCount { get; init; }
    public string? Error { get; init; }
    public string? Warning { get; init; }
}
