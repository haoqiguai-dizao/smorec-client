using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace FrameFlow.Capture;

internal sealed record LiveApplication(string Id, string Name, string Executable);
internal sealed record LiveApplicationSnapshot(LiveApplication[] Applications, LiveExcludedWindow[] Windows);

internal static class WindowsApplicationCatalog
{
    private delegate bool WindowCallback(nint window, nint data);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(WindowCallback callback, nint data);
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(nint window);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern SafeProcessHandle OpenProcess(uint access, bool inherit, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(SafeProcessHandle process, uint flags,
        StringBuilder path, ref uint length);

    internal static LiveApplicationSnapshot Capture()
    {
        _ = uint.TryParse(Environment.GetEnvironmentVariable("FRAMEFLOW_PARENT_PID"), out var parent);
        var own = checked((uint)Environment.ProcessId);
        var windows = new List<(nint Handle, uint ProcessId, bool Visible)>();
        if (!EnumWindows((window, _) =>
        {
            Win32.GetWindowThreadProcessId(window, out var process);
            // Keep hidden windows for capture; only the picker list is limited to visible applications.
            if (process != 0 && process != own && process != parent && Win32.IsWindow(window))
                windows.Add((window, process, IsWindowVisible(window)));
            return true;
        }, 0)) throw new Win32Exception(Marshal.GetLastWin32Error(), "无法读取当前软件列表，请重试。");
        var paths = new Dictionary<uint, string>();
        foreach (var process in windows.Select(window => window.ProcessId).Distinct())
            if (ReadExecutable(process) is { } path) paths.Add(process, path);
        return Build(windows, paths, Application);
    }

    internal static LiveApplicationSnapshot Build(IEnumerable<(nint Handle, uint ProcessId, bool Visible)> windows,
        IReadOnlyDictionary<uint, string> paths, Func<string, LiveApplication> describe)
    {
        var known = windows.Where(window => paths.ContainsKey(window.ProcessId)).ToArray();
        var current = known.Select(window =>
            new LiveExcludedWindow(window.Handle, window.ProcessId, paths[window.ProcessId])).ToArray();
        return new LiveApplicationSnapshot(known.Where(window => window.Visible)
            .Select(window => paths[window.ProcessId]).Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(describe).OrderBy(application => application.Name, StringComparer.CurrentCultureIgnoreCase).ToArray(), current);
    }

    private static string? ReadExecutable(uint processId)
    {
        // Query-limited access is sufficient; never request process write, VM or injection rights.
        using var process = OpenProcess(0x1000, false, processId);
        if (process.IsInvalid) return null;
        var path = new StringBuilder(LiveWindowExclusions.MaximumPathLength + 1);
        var length = (uint)path.Capacity;
        if (!QueryFullProcessImageName(process, 0, path, ref length)) return null;
        try { return LiveWindowExclusions.NormalizeApplication(path.ToString()); }
        catch (ArgumentException) { return null; }
    }

    private static LiveApplication Application(string path)
    {
        var executable = Path.GetFileName(path);
        var name = Path.GetFileNameWithoutExtension(path);
        try
        {
            var description = FileVersionInfo.GetVersionInfo(path).FileDescription;
            if (!string.IsNullOrWhiteSpace(description))
                name = new string(description.Where(character => !char.IsControl(character)).Take(80).ToArray()).Trim();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or Win32Exception)
        { /* A closed/uninstalled application still has a stable executable basename. */ }
        return new LiveApplication(path, string.IsNullOrWhiteSpace(name) ? executable : name, executable);
    }
}
