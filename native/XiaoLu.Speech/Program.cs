using System.Text;
using System.Text.Json;
using SherpaOnnx;

Console.InputEncoding = new UTF8Encoding(false);
Console.OutputEncoding = new UTF8Encoding(false);
if (args.Length != 3 || args[0] != "--server") return 2;
try
{
    var config = new OfflineRecognizerConfig();
    config.FeatConfig.SampleRate = 16000;
    config.FeatConfig.FeatureDim = 80;
    config.ModelConfig.Tokens = args[2];
    config.ModelConfig.NumThreads = 4;
    config.ModelConfig.Provider = "cpu";
    config.ModelConfig.SenseVoice.Model = args[1];
    config.ModelConfig.SenseVoice.Language = "zh";
    config.ModelConfig.SenseVoice.UseInverseTextNormalization = 1;
    using var recognizer = new Utf8Recognizer(config);
    Write(new { ready = true });
    while (Console.ReadLine() is { } path)
    {
        try
        {
            var meta = new FileInfo(path);
            if (!meta.Exists || meta.Length < 1600 || meta.Length > 16000 * 4 * 31 || meta.Length % 4 != 0)
                throw new IOException("Invalid PCM clip");
            var bytes = File.ReadAllBytes(path);
            var samples = new float[bytes.Length / 4];
            Buffer.BlockCopy(bytes, 0, samples, 0, bytes.Length);
            double power = 0;
            foreach (var sample in samples)
            {
                if (!float.IsFinite(sample)) throw new IOException("Invalid PCM sample");
                power += sample * sample;
            }
            if (Math.Sqrt(power / samples.Length) < .0012) { Write(new { ok = false, code = 6 }); continue; }
            Write(new { ok = true, text = recognizer.Recognize(samples) });
        }
        catch (Exception error) { Console.Error.WriteLine(error.GetType().Name); Write(new { ok = false, code = 3 }); }
    }
    return 0;
}
catch (Exception error) { Console.Error.WriteLine(error.GetType().Name); return 1; }

static void Write(object value) { Console.WriteLine(JsonSerializer.Serialize(value)); Console.Out.Flush(); }
