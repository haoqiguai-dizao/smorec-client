using System.ComponentModel;
using System.Runtime.InteropServices;

namespace FrameFlow.Capture;

internal sealed class RawKeyboardActivityCollector : IDisposable
{
    private static RawKeyboardActivityCollector? owner;
    private readonly CaptureClock clock;
    private readonly Action<double, TypingKeyAction> onKey;
    private readonly Action<double> onTick;
    private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly object lifecycle = new();
    private readonly RawInputWin32.WindowCallback callback;
    private readonly string className = $"FrameFlow.Typing.{Guid.NewGuid():N}";
    private Thread? thread;
    private uint threadId;
    private int stopRequested;
    private nint window;
    private Exception? error;
    private bool disposed, registered;
    private bool registrationVerified, registrationRemoved;

    internal RawKeyboardActivityCollector(CaptureClock clock, Action<double, TypingKeyAction> onKey,
        Action<double> onTick)
    {
        this.clock = clock;
        this.onKey = onKey;
        this.onTick = onTick;
        callback = RawInputWin32.DefWindowProc;
    }

    internal Exception? Error => Volatile.Read(ref error);
    internal bool ThreadExited => thread is null || !thread.IsAlive;
    internal bool RegistrationVerified => registrationVerified;
    internal bool RegistrationRemoved => registrationRemoved;
    private bool Stopping => Volatile.Read(ref stopRequested) != 0;

    internal void Start(CancellationToken cancellation = default)
    {
        lock (lifecycle)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            cancellation.ThrowIfCancellationRequested();
            if (thread is not null) throw new InvalidOperationException("Typing input is already started.");
            if (Stopping) throw new OperationCanceledException("Typing input has been stopped.");
            if (Interlocked.CompareExchange(ref owner, this, null) is not null)
                throw new InvalidOperationException("Another typing input collector is still active.");
            try
            {
                thread = new Thread(Run) { IsBackground = true, Name = "FrameFlow typing activity" };
                thread.Start();
            }
            catch
            {
                thread = null;
                Interlocked.CompareExchange(ref owner, null, this);
                throw;
            }
        }
        try
        {
            ready.Task.WaitAsync(TimeSpan.FromSeconds(3), cancellation).GetAwaiter().GetResult();
            cancellation.ThrowIfCancellationRequested();
            if (Stopping) throw new OperationCanceledException("Typing input has been stopped.");
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
            if (!Stopping) RunMessages();
        }
        catch (Exception ex) { SetError(ex); }
        finally
        {
            if (!Stopping && Error is null) SetError(new InvalidOperationException("Typing input ended unexpectedly."));
            lock (lifecycle) Volatile.Write(ref threadId, 0);
            Interlocked.CompareExchange(ref owner, null, this);
            ready.TrySetResult();
        }
    }

    private void RunMessages()
    {
        var instance = Win32.GetModuleHandle(null);
        var windowClass = new RawInputWin32.WindowClass
        {
            Size = (uint)Marshal.SizeOf<RawInputWin32.WindowClass>(), Instance = instance,
            ClassName = className, Procedure = Marshal.GetFunctionPointerForDelegate(callback)
        };
        if (RawInputWin32.RegisterClassEx(ref windowClass) == 0) throw NativeError("Register typing window class");
        try
        {
            if (Stopping) return;
            window = RawInputWin32.CreateWindowEx(0, className, "", 0, 0, 0, 0, 0, (nint)(-3), 0, instance, 0);
            if (window == 0) throw NativeError("Create typing input window");
            if (Stopping) return;
            if (ReadRegistrations().Any(item => item.UsagePage == 1 && item.Usage == 6))
                throw new InvalidOperationException("A keyboard input registration is already owned by this process.");
            var device = new RawInputWin32.Device { UsagePage = 1, Usage = 6, Flags = RawInputWin32.InputSink, Target = window };
            if (!RawInputWin32.RegisterRawInputDevices([device], 1, (uint)Marshal.SizeOf<RawInputWin32.Device>()))
                throw NativeError("Register asynchronous typing input");
            registered = true;
            if (Stopping) return;
            registrationVerified = ReadRegistrations().Any(item => item.UsagePage == 1 && item.Usage == 6
                && item.Target == window && item.Flags == RawInputWin32.InputSink);
            if (!registrationVerified) throw new InvalidOperationException("Typing input registration could not be verified.");
            if (TypingFocusWin32.SetTimer(window, 1, 50, 0) == 0) throw NativeError("Schedule typing focus checks");
            ready.TrySetResult();
            while (!Stopping)
            {
                var result = Win32.GetMessage(out var message, 0, 0, 0);
                if (result == 0) break;
                if (result < 0) throw NativeError("Read typing input messages");
                try
                {
                    if (message.Hwnd != window || Error is not null || Stopping) continue;
                    if (message.Id == RawInputWin32.InputMessage) ReadInput(message.LParam);
                    else if (message.Id == 0x0113) onTick(clock.Seconds);
                }
                finally { Win32.DispatchMessage(ref message); }
            }
        }
        finally
        {
            if (window != 0) TypingFocusWin32.KillTimer(window, 1);
            if (registered)
            {
                var remove = new RawInputWin32.Device { UsagePage = 1, Usage = 6, Flags = RawInputWin32.Remove };
                if (!RawInputWin32.RegisterRawInputDevices([remove], 1, (uint)Marshal.SizeOf<RawInputWin32.Device>()))
                    SetError(NativeError("Remove typing input registration"));
                else
                {
                    try
                    {
                        registrationRemoved = !ReadRegistrations().Any(item => item.UsagePage == 1 && item.Usage == 6);
                        if (!registrationRemoved) SetError(new InvalidOperationException("Typing registration remains after removal."));
                    }
                    catch (Exception ex) { SetError(ex); }
                }
                registered = false;
            }
            if (window != 0)
            {
                if (!RawInputWin32.DestroyWindow(window)) SetError(NativeError("Destroy typing input window"));
                window = 0;
            }
            if (!RawInputWin32.UnregisterClass(className, instance)) SetError(NativeError("Unregister typing window class"));
            GC.KeepAlive(callback);
        }
    }

    private void ReadInput(nint handle)
    {
        var packet = default(RawInputWin32.Input);
        var size = (uint)Marshal.SizeOf<RawInputWin32.Input>();
        var result = RawInputWin32.GetRawInputData(handle, RawInputWin32.ReadInput, ref packet, ref size,
            (uint)Marshal.SizeOf<RawInputWin32.Header>());
        if (result == uint.MaxValue) throw NativeError("Read typing activity packet");
        var bytes = MemoryMarshal.AsBytes(MemoryMarshal.CreateSpan(ref packet, 1));
        try
        {
            if (result > bytes.Length || !RawKeyboardActivity.TryClassify(bytes[..(int)result], IntPtr.Size,
                TypingFocusWin32.ShortcutHeld(), out var action))
                throw new InvalidOperationException("Invalid typing activity packet.");
            // Only the activity category crosses this boundary, never the original packet or key.
            if (action != TypingKeyAction.Ignore) onKey(clock.Seconds, action);
        }
        finally { bytes.Clear(); }
    }

    internal static RawInputWin32.Device[] ReadRegistrations()
    {
        uint count = 0;
        var size = (uint)Marshal.SizeOf<RawInputWin32.Device>();
        if (RawInputWin32.GetRegisteredRawInputDevices(null, ref count, size) == uint.MaxValue)
            throw NativeError("Inspect typing input registration");
        if (count == 0) return [];
        var devices = new RawInputWin32.Device[count];
        if (RawInputWin32.GetRegisteredRawInputDevices(devices, ref count, size) == uint.MaxValue)
            throw NativeError("Read typing input registration");
        return devices;
    }

    internal void SetError(Exception exception)
    {
        Interlocked.CompareExchange(ref error, exception, null);
        Interlocked.Exchange(ref stopRequested, 1);
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
            var id = Volatile.Read(ref threadId);
            if (id != 0) Win32.PostThreadMessage(id, 0x0012, 0, 0);
        }
        return active.Join(TimeSpan.FromSeconds(2));
    }

    public void Dispose()
    {
        lock (lifecycle)
        {
            if (disposed) return;
            disposed = true;
        }
        Stop();
    }
}
