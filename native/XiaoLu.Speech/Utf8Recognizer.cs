using System.Runtime.InteropServices;
using System.Text.Json;
using SherpaOnnx;

// The pinned SDK uses LPStr (Windows ANSI), while its native file loader expects UTF-8.
// Keep the SDK's ABI layout and replace only the two non-ASCII path pointers.
internal sealed class Utf8Recognizer : IDisposable
{
    private IntPtr handle;
    private const string Library = "sherpa-onnx-c-api";

    public Utf8Recognizer(OfflineRecognizerConfig config)
    {
        var memory = Marshal.AllocHGlobal(Marshal.SizeOf<OfflineRecognizerConfig>());
        var modelOffset = Offset<OfflineRecognizerConfig>(nameof(config.ModelConfig));
        var tokenOffset = modelOffset + Offset<OfflineModelConfig>(nameof(config.ModelConfig.Tokens));
        var senseOffset = modelOffset + Offset<OfflineModelConfig>(nameof(config.ModelConfig.SenseVoice))
            + Offset<OfflineSenseVoiceModelConfig>(nameof(config.ModelConfig.SenseVoice.Model));
        IntPtr tokens = IntPtr.Zero, model = IntPtr.Zero, oldTokens = IntPtr.Zero, oldModel = IntPtr.Zero;
        var marshaled = false;
        try
        {
            Marshal.StructureToPtr(config, memory, false); marshaled = true;
            oldTokens = Marshal.ReadIntPtr(memory, tokenOffset); oldModel = Marshal.ReadIntPtr(memory, senseOffset);
            tokens = Marshal.StringToCoTaskMemUTF8(config.ModelConfig.Tokens);
            model = Marshal.StringToCoTaskMemUTF8(config.ModelConfig.SenseVoice.Model);
            Marshal.WriteIntPtr(memory, tokenOffset, tokens); Marshal.WriteIntPtr(memory, senseOffset, model);
            handle = SherpaOnnxCreateOfflineRecognizer(memory);
            if (handle == IntPtr.Zero) throw new InvalidOperationException("Model initialization failed");
        }
        finally
        {
            if (marshaled)
            {
                Marshal.WriteIntPtr(memory, tokenOffset, oldTokens); Marshal.WriteIntPtr(memory, senseOffset, oldModel);
                Marshal.DestroyStructure<OfflineRecognizerConfig>(memory);
            }
            Marshal.FreeCoTaskMem(tokens); Marshal.FreeCoTaskMem(model); Marshal.FreeHGlobal(memory);
        }
    }

    public string Recognize(float[] samples)
    {
        ObjectDisposedException.ThrowIf(handle == IntPtr.Zero, this);
        var stream = SherpaOnnxCreateOfflineStream(handle);
        if (stream == IntPtr.Zero) throw new InvalidOperationException("Stream initialization failed");
        try
        {
            SherpaOnnxAcceptWaveformOffline(stream, 16000, samples, samples.Length);
            SherpaOnnxDecodeOfflineStream(handle, stream);
            var result = SherpaOnnxGetOfflineStreamResultAsJson(stream);
            if (result == IntPtr.Zero) throw new InvalidOperationException("No recognition result");
            try
            {
                using var json = JsonDocument.Parse(Marshal.PtrToStringUTF8(result)!);
                return json.RootElement.GetProperty("text").GetString() ?? "";
            }
            finally { SherpaOnnxDestroyOfflineStreamResultJson(result); }
        }
        finally { SherpaOnnxDestroyOfflineStream(stream); }
    }

    public void Dispose()
    {
        if (handle != IntPtr.Zero) { SherpaOnnxDestroyOfflineRecognizer(handle); handle = IntPtr.Zero; }
    }

    private static int Offset<T>(string field) => Marshal.OffsetOf<T>(field).ToInt32();
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr SherpaOnnxCreateOfflineRecognizer(IntPtr config);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void SherpaOnnxDestroyOfflineRecognizer(IntPtr recognizer);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr SherpaOnnxCreateOfflineStream(IntPtr recognizer);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void SherpaOnnxDestroyOfflineStream(IntPtr stream);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void SherpaOnnxAcceptWaveformOffline(IntPtr stream, int rate, float[] samples, int count);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void SherpaOnnxDecodeOfflineStream(IntPtr recognizer, IntPtr stream);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr SherpaOnnxGetOfflineStreamResultAsJson(IntPtr stream);
    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void SherpaOnnxDestroyOfflineStreamResultJson(IntPtr result);
}
