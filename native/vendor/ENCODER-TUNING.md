# Software video encoder tuning

The Windows helper records screen video through Media Foundation while its audio and cursor workers run separately. The software-encoder tuning module runs once after the sink writer accepts its video input type and before `BeginWriting`; it does not modify per-frame capture/render logic.

## Parameters and safety

The default requests `CODECAPI_AVEncCommonQualityVsSpeed=25` and `CODECAPI_AVEncNumWorkerThreads=2`. Two workers were selected after controlled 1080p60 screen + camera preview comparisons, while the explicit `auto` override still requests 0. The development machine's original complexity is 33, which is also within Microsoft's low-complexity range; complexity 25 alone is not established as the reason for an improvement.

| Diagnostic environment variable | Behavior |
| --- | --- |
| `FRAMEFLOW_CAPTURE_ENCODER_TUNING=baseline` | Logs values and applies no tuning. |
| `FRAMEFLOW_CAPTURE_ENCODER_THREADS` unset | Requests two video encoder workers. |
| `FRAMEFLOW_CAPTURE_ENCODER_THREADS=auto` | Requests automatic video encoder worker selection (0). |
| `FRAMEFLOW_CAPTURE_ENCODER_THREADS=0..16` | Requests that number of video encoder workers; 4 and 2 are comparison candidates. |
| Invalid worker value | Logs the invalid override and uses the default two workers. |
| `FRAMEFLOW_CAPTURE_ENCODER=software` | Explicit software comparison; applies this tuning. Ordinary startup now prefers hardware, which bypasses this module. |

The module queries `ICodecAPI` for the selected video stream. Each setting saves its previous value, checks support, attempts the documented value and reads it back. Unsupported properties are left unchanged. A rejected setter or failed readback triggers a best-effort restore and records HRESULTs; if restore also fails, the current codec state is logged and startup continues without rebuilding the codec. This is not a guarantee that every failed configuration can recover its original state. The validated inbox encoder accepts and reads back both requested settings. It returns `E_NOTIMPL` for `IsModifiable` and `GetParameterRange`, so those optional capability queries alone cannot be used to declare the setter unsupported.

One-time `[EncoderTuning]` lines are written whenever native encoder logging is enabled, including when per-frame log verbosity is suppressed. They record actual rate control, quality, bitrate, low latency, complexity and worker values. Optional encoder metadata is marked unavailable rather than guessed.

Sink-writer throttling stays enabled: `WriteSample` provides backpressure instead of allowing unbounded input queues. The module does not set process affinity, process/thread priority, audio gain, mouse-hook behavior, source dimensions, frame rate, sample timestamps, or the existing stale-frame flush behavior. Audio and cursor workers are unaffected by `AVEncNumWorkerThreads`.

## Local verification, 2026-09-07

`output/encoder-capability-probe/` holds an isolated, device-free capability probe and results. It enumerates software H.264 encoders, activates the encoder and reads CodecAPI attributes. A second probe creates an in-memory MP4 sink writer with a 1920×1080 / 60 fps media type, quality-based rate control, configured quality 85, bitrate 15,552,000 and low latency. It submits no frames and never calls `BeginWriting`, `ProcessInput`, or capture APIs.

| Evidence | Result |
| --- | --- |
| `report.txt` | One software encoder: H264 Encoder MFT, CLSID `6CA50344-051A-4DED-9779-A43305165E35`; initial complexity 33, workers 0. |
| `sink-baseline.txt` | Baseline preserved: complexity 33, workers 0, rate mode 3 (quality), quality readback 86, bitrate 15,552,000, low latency true. |
| `sink-auto.txt` | Complexity 25 and workers 0 accepted and read back. |
| `sink-4.txt` | Complexity 25 and workers 4 accepted and read back. |
| `sink-2.txt` | Complexity 25 and workers 2 accepted and read back. |
| `replay.txt` | Fresh pinned Git index plus both ordered patches matches current built source. |

The sink-writer probe confirms the existing initialization attributes do reach this codec. The configured quality 85 is quantized to a readback of 86; tuning does not alter that mapping. The probe deliberately supplies NV12 directly and does not create the full D3D capture/conversion path. It proves configuration support, not desktop latency, sustained 60 fps, timing correctness or recording quality.

The final two-worker C++ fork rebuild compiled all 32 native sources and the managed C++/CLI bridge in 30.63 seconds. The original 0.8.0 DLL remains copied to `output/encoder-capability-probe/ScreenRecorderLib-0.8.0-baseline.dll`, SHA-256 `559f83d76d640ed70731fa4b6464ce582c29f9c2cca2c9d7c925d28cc7b7d4f3`. Existing user installations and `release-v0.8.0` were not changed.

## Controlled worker comparison

The same deterministic 1920×1080 scrolling source was recorded at 60 fps with a synthetic 1080p30 camera, natural beauty enabled and the updated display-sized camera transport. All targets were owned test windows; no physical camera, microphone, system audio or uncovered desktop was captured. The measured recording phase is approximately five seconds per run.

| Configuration / `output/` evidence | App + native CPU, one-core % | Native CPU, one-core % | Controlled source frame-gap p95 |
| --- | ---: | ---: | ---: |
| `perf-preview-change-60/report.json`, codec baseline | 249.10 | 94.50 | 33.3 ms |
| `perf-threads4-60/report.json`, complexity 25 / four workers | 243.46 | 93.49 | 33.3 ms |
| `perf-threads2-60/report.json`, complexity 25 / two workers | 224.24 | 84.42 | 16.8 ms |

All three runs passed their controlled recording checks. The two-worker source was fully decoded and retained 1920×1080 screen output and original 1080p camera coverage. These finite samples support choosing two workers on the tested machine; they do not demonstrate actual mouse-event latency, all-device compatibility, physical audio quality or long-session throughput. CPU is summed processor time normalized to one core, so values above 100% are expected and are not the whole-machine percentage shown by Task Manager.

Complete performance acceptance must compare fixed 1080p60 content under the same screen + camera + beauty settings, including input response, per-process CPU, late frames, recording durations, audio continuity and text readability. Do not infer whole-system performance from successful setters.

## References

- [Microsoft H.264 encoder properties and threading](https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder)
- [ICodecAPI through GetServiceForStream](https://learn.microsoft.com/en-us/windows/win32/api/mfreadwrite/nf-mfreadwrite-imfsinkwriter-getserviceforstream)
- [Sink writer backpressure](https://learn.microsoft.com/en-us/windows/win32/medfound/mf-sink-writer-disable-throttling)
