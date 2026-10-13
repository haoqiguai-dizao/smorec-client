using FrameFlow.Capture;

internal static class CaptureSpecificationTests
{
    internal static void Run(Action<bool, string> check)
    {
        void Size(int width, int height, string resolution, int expectedWidth, int expectedHeight, string? diagnostic = null)
        {
            check(CaptureSpecification.Resolve(width, height, resolution, diagnostic) == new CaptureDimensions(expectedWidth, expectedHeight),
                $"capture {width}x{height} {resolution} / {diagnostic ?? "default"} resolves to {expectedWidth}x{expectedHeight}");
        }
        void Rejected(Action resolve, string name)
        {
            try { resolve(); throw new InvalidOperationException(name + " was accepted"); }
            catch (ArgumentException) { check(true, name + " is rejected"); }
        }
        Size(3840, 2160, "native", 3840, 2160);
        Size(2160, 3840, "native", 2160, 3840);
        Size(3840, 2160, "2160p", 3840, 2160);
        Size(3840, 2160, "1440p", 2560, 1440);
        Size(3840, 2160, "1080p", 1920, 1080);
        Size(3841, 2160, "1080p", 1920, 1080);
        Size(2160, 3841, "1080p", 1080, 1920);
        Size(1921, 1081, "2160p", 1920, 1080);
        Size(2160, 3840, "1080p", 1080, 1920);
        Size(3440, 1440, "1440p", 2560, 1070);
        Size(1280, 720, "2160p", 1280, 720);
        Size(853, 481, "native", 852, 480);
        Size(16384, 4096, "2160p", 3840, 960);
        Size(8192, 4000, "native", 8192, 4000);
        Size(7680, 4320, "native", 7680, 4320);
        Size(3840, 2160, "native", 1280, 720, "1280");
        Size(3840, 2160, "1080p", 3840, 2160, "3840");
        Rejected(() => CaptureSpecification.Resolve(3840, 2160, "4k"), "unknown resolution");
        Rejected(() => CaptureSpecification.Resolve(3840, 2160, null!), "explicit null resolution");
        Rejected(() => CaptureSpecification.Resolve(0, 2160, "native"), "empty source");
        Rejected(() => CaptureSpecification.Resolve(16385, 2160, "1080p"), "oversized source");
        Rejected(() => CaptureSpecification.Resolve(10000, 4000, "native"), "unsupported original output");
        Rejected(() => CaptureSpecification.Resolve(8192, 4320, "native"), "output exceeding pixel budget");
        Rejected(() => CaptureSpecification.Resolve(16384, 2, "1080p"), "collapsed output dimension");
        foreach (var invalid in new[] { "", "auto", "639", "8193", "1920.5", "-1" })
            Rejected(() => CaptureSpecification.Resolve(3840, 2160, "native", invalid), "invalid diagnostic maximum " + invalid);
        var legacy = Protocol.Parse("""{"id":1,"command":"start","options":{"sourceId":"window:1","fps":30}}""");
        check(legacy.Options?.Resolution == "native", "legacy capture options default to native resolution");
        var explicitResolution = Protocol.Parse("""{"id":2,"command":"start","options":{"sourceId":"window:1","fps":60,"resolution":"2160p"}}""");
        check(explicitResolution.Options?.Resolution == "2160p", "selected capture resolution survives protocol transport");
    }
}
