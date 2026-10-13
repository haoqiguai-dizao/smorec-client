using System.Globalization;

namespace FrameFlow.Capture;

internal readonly record struct LiveExcludedWindow(nint Handle, uint ProcessId, string ApplicationId);

// A single startup snapshot. No window visibility, global capture affinity or application state is changed.
internal static class LiveWindowExclusions
{
    internal const int MaximumApplications = 32;
    internal const int MaximumPathLength = 1024;

    internal static bool IsDefaultExecutable(string path)
    {
        var name = path.Replace('\\', '/').Split('/')[^1];
        return name.Equals("直播伴侣.exe", StringComparison.OrdinalIgnoreCase)
            || name.Equals("xhs-live-helper.exe", StringComparison.OrdinalIgnoreCase);
    }

    internal static string NormalizeApplication(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > MaximumPathLength || path.Length < 7
            || !char.IsAsciiLetter(path[0]) || path[1] != ':' || path[2] is not ('\\' or '/')
            || path.AsSpan(2).Contains(':') || path.Any(character => char.IsControl(character)
                || character is '"' or '*' or '?' or '<' or '>' or '|'))
            throw new ArgumentException("排除软件必须使用有效的本地程序绝对路径。");
        var full = Path.GetFullPath(path.Replace('/', '\\'));
        if (!full.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || full.Length > MaximumPathLength)
            throw new ArgumentException("排除软件必须使用有效的本地 EXE 路径。");
        return full;
    }

    internal static string[]? NormalizeApplications(string[]? applications)
    {
        if (applications is null) return null;
        if (applications.Length > MaximumApplications) throw new ArgumentException("最多可选择 32 个排除软件。");
        return applications.Select(NormalizeApplication).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    internal static RecordingOptions ForRecording(RecordingOptions options)
    {
        var applications = NormalizeApplications(options.ExcludedApplications ?? []) ?? [];
        if (applications.Length == 0) return options;
        var snapshot = WindowsApplicationCatalog.Capture().Windows;
        if (options.SourceId.StartsWith("window:", StringComparison.Ordinal)
            && long.TryParse(options.SourceId[7..], out var handle)
            && Select(snapshot, applications).Any(window => window.Handle.ToInt64() == handle))
            throw new ArgumentException("当前录制窗口所属应用已被排除，请选择其他来源或取消排除。");
        return Merge(options, Current(Select(snapshot, applications), IsCurrent));
    }

    internal static LiveExcludedWindow[] Snapshot(RecordingOptions options)
    {
        var applications = NormalizeApplications(options.ExcludedApplications);
        if (!options.SourceId.StartsWith("screen:", StringComparison.Ordinal) || applications is { Length: 0 }) return [];
        return Select(WindowsApplicationCatalog.Capture().Windows, applications);
    }

    internal static LiveExcludedWindow[] Select(IEnumerable<LiveExcludedWindow> windows, string[]? applications)
    {
        var selected = applications is null ? null : new HashSet<string>(applications, StringComparer.OrdinalIgnoreCase);
        return windows.Where(window => selected is null ? IsDefaultExecutable(window.ApplicationId)
            : selected.Contains(window.ApplicationId)).Distinct().ToArray();
    }

    internal static bool IsCurrent(LiveExcludedWindow window)
    {
        if (window.Handle <= 0 || !Win32.IsWindow(window.Handle)) return false;
        Win32.GetWindowThreadProcessId(window.Handle, out var processId);
        return processId != 0 && processId == window.ProcessId;
    }

    internal static LiveExcludedWindow[] Current(IEnumerable<LiveExcludedWindow> windows,
        Func<LiveExcludedWindow, bool> isCurrent) =>
        windows.Where(window => window.Handle > 0 && window.ProcessId != 0 && isCurrent(window)).Distinct().ToArray();

    internal static RecordingOptions Merge(RecordingOptions options, IEnumerable<LiveExcludedWindow> windows)
    {
        if (!options.SourceId.StartsWith("screen:", StringComparison.Ordinal)) return options;
        // Keep every requested own HWND, including invalid values: SourceCatalog must still reject them.
        var handles = new HashSet<string>(options.ExcludeWindowHandles ?? [], StringComparer.Ordinal);
        foreach (var window in windows)
            handles.Add(window.Handle.ToInt64().ToString(CultureInfo.InvariantCulture));
        // Application count is bounded at input; one application may own many visible and hidden HWNDs.
        // Keep every matching HWND; do not silently truncate the user's selected applications.
        return options with { ExcludeWindowHandles = handles.ToArray() };
    }

    internal static bool OwnWindowsValid(RecordingOptions options, Func<nint, bool> isWindow) =>
        (options.ExcludeWindowHandles ?? []).All(value =>
            long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var handle)
            && handle > 0 && isWindow((nint)handle));
}
