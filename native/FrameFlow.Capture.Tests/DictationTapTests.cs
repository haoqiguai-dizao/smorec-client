using System.Text.Json;
using NAudio.Wave;
using FrameFlow.Capture;

internal static class DictationTapTests
{
    internal static async Task RunAsync(Action<bool, string> check)
    {
        var directory = Path.Combine(Path.GetTempPath(), "xiaolu-dictation-test-" + Guid.NewGuid(), "中文路径");
        Directory.CreateDirectory(directory);
        try
        {
            var format = WaveFormat.CreateIeeeFloatWaveFormat(16000, 1);
            var samples = Enumerable.Repeat(.125f, 3200).ToArray();
            var data = new byte[samples.Length * 4]; Buffer.BlockCopy(samples, 0, data, 0, data.Length);
            using var tap = new DictationTap(format);
            var id = Guid.NewGuid().ToString();
            var starting = tap.BeginAsync(directory, id, CancellationToken.None);
            tap.Append(data, 0, data.Length); await starting;
            tap.Cancel(Guid.NewGuid().ToString());
            var result = JsonSerializer.SerializeToElement(tap.End(id));
            check(Math.Abs(result.GetProperty("duration").GetDouble() - .2) < .001, "dictation duration comes from captured samples");
            using (var wav = new WaveFileReader(Path.Combine(directory, "microphone.wav")))
            {
                var actual = new byte[data.Length]; wav.ReadExactly(actual);
                check(actual.SequenceEqual(data), "dictation preserves the original microphone samples on Unicode paths");
            }
            check(Math.Abs(AudioLevel.Measure(data, 0, data.Length, format) - .5) < .001, "float microphone level is normalized");
            var bounded = Path.Combine(directory, "bounded");
            id = Guid.NewGuid().ToString(); starting = tap.BeginAsync(bounded, id, CancellationToken.None);
            var longData = new byte[16000 * 4 * 31];
            tap.Append(longData, 0, longData.Length); await starting;
            result = JsonSerializer.SerializeToElement(tap.End(id));
            check(result.GetProperty("duration").GetDouble() == 30, "dictation clips are bounded to thirty seconds");
            var cancelled = Path.Combine(directory, "cancelled");
            id = Guid.NewGuid().ToString(); starting = tap.BeginAsync(cancelled, id, CancellationToken.None);
            tap.Cancel(id);
            try { await starting; throw new Exception("cancel did not interrupt readiness"); }
            catch (OperationCanceledException) { check(true, "clip-scoped cancellation interrupts readiness without touching recording"); }
        }
        finally { Directory.Delete(directory, true); }
    }
}
