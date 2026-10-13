using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace FrameFlow.Capture;

// Prefixes of the Windows SDK IUnknown vtables. Only GetFocusedElement and geometric/boolean
// properties are invoked; no text, value, name, selection or input APIs are used.
internal static class TypingFocusAutomation
{
    [ComImport, Guid("30cbe57d-d9d0-452a-ab13-7ac5ac4825ee"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface Automation
    {
        void CompareElements(nint first, nint second, out int same);
        void CompareRuntimeIds(nint first, nint second, out int same);
        void GetRootElement(out nint root);
        void ElementFromHandle(nint window, out nint element);
        void ElementFromPoint(Win32.Point point, out nint element);
        void GetFocusedElement([MarshalAs(UnmanagedType.Interface)] out Element element);
    }

    [ComImport, Guid("d22108aa-8ac5-49a5-837b-37bbb3d7591e"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface Element
    {
        void SetFocus();
        void GetRuntimeId(out nint id);
        void FindFirst(int scope, nint condition, out nint found);
        void FindAll(int scope, nint condition, out nint found);
        void FindFirstBuildCache(int scope, nint condition, nint cache, out nint found);
        void FindAllBuildCache(int scope, nint condition, nint cache, out nint found);
        void BuildUpdatedCache(nint cache, out nint updated);
        void GetCurrentPropertyValue(int id, [MarshalAs(UnmanagedType.Struct)] out object value);
    }

    [SupportedOSPlatform("windows")]
    internal static double[]? ReadEditorBounds(InputFocus expected)
    {
        Automation? automation = null;
        Element? element = null;
        try
        {
            if (TypingFocusWin32.Read() != expected) return null;
            var type = Type.GetTypeFromCLSID(new Guid("ff48dba4-60ef-4201-aa87-54103eef594e"), true)!;
            automation = (Automation)Activator.CreateInstance(type)!;
            automation.GetFocusedElement(out element);
            // UIA providers may belong to renderer processes, so ownership is validated through
            // their physical location in the expected foreground window as well as native focus.
            element.GetCurrentPropertyValue(30003, out var controlType);
            if (controlType is not int control || control != 50004) return null; // UIA_EditControlTypeId
            element.GetCurrentPropertyValue(30008, out var focused);
            element.GetCurrentPropertyValue(30010, out var enabled);
            element.GetCurrentPropertyValue(30022, out var offscreen);
            if (focused is not true || enabled is not true || offscreen is not false) return null;
            element.GetCurrentPropertyValue(30001, out var bounds);
            if (bounds is not double[] rect || rect.Length != 4 || rect.Any(value => !double.IsFinite(value))) return null;
            var x = rect[0] + rect[2] / 2;
            var y = rect[1] + rect[3] / 2;
            if (x < int.MinValue || x > int.MaxValue || y < int.MinValue || y > int.MaxValue) return null;
            var point = new Win32.Point { X = (int)x, Y = (int)y };
            if (!TypingFocusWin32.PointBelongsTo(point, expected) || TypingFocusWin32.Read() != expected) return null;
            // Re-read after the properties so an element that just lost focus is discarded.
            element.GetCurrentPropertyValue(30008, out focused);
            return focused is true ? rect : null;
        }
        catch (Exception ex) when (ex is COMException or InvalidCastException or TypeLoadException
            or System.Reflection.TargetInvocationException) { return null; }
        finally
        {
            if (element is not null) Marshal.FinalReleaseComObject(element);
            if (automation is not null) Marshal.FinalReleaseComObject(automation);
        }
    }
}
