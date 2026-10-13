using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;

namespace FrameFlow.Capture;

internal static class MicrophoneCatalog
{
    internal static MicrophoneDevice[] List()
    {
        using var devices = new MMDeviceEnumerator();
        string? defaultId = null;
        try
        {
            using var current = devices.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Multimedia);
            defaultId = current.ID;
        }
        catch (COMException) { /* An active device list can exist without a default endpoint. */ }
        var result = new List<MicrophoneDevice>();
        foreach (var device in devices.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active))
        {
            using (device) result.Add(new(device.ID, device.FriendlyName, device.ID == defaultId));
        }
        return result.OrderByDescending(device => device.IsDefault).ThenBy(device => device.Name).ToArray();
    }

    internal static void ValidateSelection(RecordingOptions options)
    {
        if (!options.Microphone || string.IsNullOrWhiteSpace(options.MicrophoneDeviceId)) return;
        using var selected = OpenSelected(options.MicrophoneDeviceId);
    }

    internal static MMDevice OpenSelected(string id)
    {
        using var devices = new MMDeviceEnumerator();
        MMDevice? selected = null;
        try
        {
            selected = devices.GetDevice(id);
            if (selected.DataFlow != DataFlow.Capture || selected.State != DeviceState.Active)
                throw new InvalidOperationException("所选麦克风已断开或不可用，请重新选择输入设备。");
            return selected;
        }
        catch (Exception ex) when (ex is COMException or InvalidOperationException or ArgumentException)
        {
            selected?.Dispose();
            throw new InvalidOperationException("所选麦克风已断开或不可用，请重新选择输入设备。", ex);
        }
    }
}
