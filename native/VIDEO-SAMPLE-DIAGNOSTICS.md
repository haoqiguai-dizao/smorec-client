# Video sample timing diagnostics

`FRAMEFLOW_CAPTURE_SAMPLE_DIAGNOSTICS=1` enables observation immediately around the existing video `IMFSinkWriter::WriteSample` calls. The default is off. It applies to software and hardware sessions, including the manual NV12 conversion branch. It does not set sample properties, replace a write, alter a return value, drain/flush a queue, change frame scheduling, or change any encoder defaults.

The implementation is split into `VideoSampleMetrics.h` (pure fixed-size statistics) and `VideoSampleDiagnostics.{h,cpp}` (read-only sample queries, QPC timing, final logging). `OutputManager` only owns the diagnostic member, observes before/after both video write sites, and reports after its existing finalization wait. RecordingManager constructs a fresh OutputManager per recording. Audio writes are not observed.

## Enable and inspect

Set the environment variable on the helper/test process before recording. Native encoder logging must also be enabled; the application's normal `encoder-software.log` or `encoder-hardware.log` provides the destination. At finalization, search that log for `[VideoSamples]`. No physical device or user desktop capture is needed to verify the module's statistics:

```powershell
./native/scripts/test-video-sample-metrics.ps1
```

For a controlled recording comparison, set `FRAMEFLOW_CAPTURE_SAMPLE_DIAGNOSTICS=1` in the benchmark process environment and use its own named test window. Keep the encoder, dimensions, FPS and synthetic-camera setup identical between runs. Do not change the queue/flush policy while collecting the initial observation baseline.

`FRAMEFLOW_CAPTURE_FRAGMENTED_MP4=0` selects the existing standard MP4 sink for a diagnostic comparison; unset or any other value retains the default fragmented sink. The helper reads this once per VideoCapture instance and records `fragmentedMp4` in `video-start`. This does not modify WriteSample, flushes or encoder configuration. Standard MP4 needs successful finalization to write its full metadata, so it cannot replace fragmented recording's crash recovery without a separate design and validation. It is not the production default.

| Field | Meaning |
| --- | --- |
| `attempted`, `accepted`, `failed` | Actual calls observed; accepted means WriteSample returned a successful HRESULT, not that the muxer retained that sample. |
| `firstPts100ns`, `lastPts100ns`, `lastEnd100ns` | First and last accepted valid input timestamps, and last PTS plus duration. Values are from IMFSample, before WriteSample. |
| `durationSum100ns` | Sum of accepted valid input durations. Compare both this and the timestamp range with MP4 timing. |
| `gaps`, `gap100ns` | Accepted input PTS exceeds the previous accepted valid sample's end. |
| `overlaps`, `overlap100ns`, `nonMonotonic` | Overlap with the previous accepted valid end; repeated or backward input PTS is counted separately. |
| `invalidTiming` | Accepted writes whose timing query failed, PTS is negative, duration is nonpositive, or end would overflow. Excluded from timing aggregates. |
| `writeWait` | Call duration from QPC immediately before WriteSample to immediately after its return; includes sink backpressure. Mean and maximum are measured; p95 is a histogram upper bound, capped by the observed maximum. |
| `first`, `last` | First eight and last eight attempted writes, including failures; one-based attempt number, PTS, duration, QPC before/after, validity and HRESULT. The two groups can overlap for short recordings. |
| `finalize` | Finalize HRESULT including the asynchronous writer callback result once available. The fourth patch preserves callback failure before this observation is reported; older three-patch logs captured only the synchronous result. |

PTS and sample duration use 100 ns units, so divide by 10,000,000 for seconds. QPC values use the reported `qpcFrequency`; subtract QPC values before dividing. Compare QPC differences, not raw QPC values against DateTime/Unix timestamps. Processing before WriteSample and callback delivery after it are outside this measured wait, so callback times are not a substitute for input sample timestamps.

The statistics retain 16 observations and 14 histogram buckets, using less than 2 KiB per OutputManager. They never retain pixels, audio or an unbounded sample list. Enabled diagnostics perform two timing getters, two QPC calls and fixed-size statistics per write; no per-frame logs or allocations are added. Disabled diagnostics skip those queries, timers, statistics and logs. A maximum of 18 short log lines is emitted once after finalization, and logging exceptions are contained. This is instrumentation, not a performance fix.

## How to distinguish a shortened timeline

1. Confirm the raw MP4's real packets/decoded frames without FFmpeg frame duplication (`-fps_mode passthrough` for decode). Read actual fragmented-MP4 `trun` durations, rather than treating nominal FFmpeg packet duration as the variable sample duration.
2. Compare accepted input count, input duration sum, first/last range and QPC progression with encoded packet count and final MP4 end. Input timestamps already short implicate the upstream timeline/conversion path. Valid full-length input followed by shorter MP4 output narrows investigation to the encoder/sink path. Successful WriteSample is not proof a later flush retained a queued sample.
3. Examine first/last observations and waits to distinguish startup/finalization delay from interior timestamp loss. A matching packet count alone cannot establish matching timing, and a slow WriteSample alone does not establish desktop input latency.

The old 0.8.1 controlled 4K60 hardware result at `output/recording-4k-hardware-baseline-081/` has 354 decoded frames and 354 successful frame callbacks. Independent MP4 inspection found a 60,000-unit timescale, 31 fragments, no `tfdt`, zero composition offsets and 583,008 summed `trun` duration units: 9.7168 seconds. FFmpeg passthrough decode also returned 354 frames. Capture reported 10.2951207 seconds, a 0.5783207-second difference. This validates the existing MP4 duration parser on that artifact; it does not prove a hardware MFT defect or dropped frames. That baseline lacks the input observations added here.

Microsoft documents that [IMFSinkWriter::Flush drops pending samples and flushes the encoder](https://learn.microsoft.com/en-us/windows/win32/api/mfreadwrite/nf-mfreadwrite-imfsinkwriter-flush). That makes the existing periodic flush a hypothesis requiring direct comparison, not a confirmed explanation of the above artifact. The observation patch deliberately leaves that behavior unchanged. [Sink writer throttling](https://learn.microsoft.com/en-us/windows/win32/medfound/mf-sink-writer-disable-throttling) also remains enabled.

## Fragment boundary isolation, 2026-09-08

The new hardware observation at `output/recording-4k-hardware-observed/videos/FrameFlow/92021511-b5a4-47f1-aed2-3f393a08ffcb/` recorded 445 accepted input samples with continuous PTS and duration sum 10.2342607 seconds. The MP4 contains the same 445 samples but its 32 fragments sum to 9.98155 seconds. All fragment-ending sample durations are exactly 1/60 second. First eight sample timestamps agree within rounding, while the last eight already differ by about 252 ms. The file's own `tfra` random-access times exceed the implicit `trun` timeline by 93.083 ms at sample 129, 169.067 ms at sample 257 and 237.4 ms at sample 385. This difference is far larger than the less-than-7.42 ms bound from truncating 445 durations to the 60,000-unit timescale.

The otherwise equivalent standard MP4 observation at `output/recording-4k-hardware-flat-observed/videos/FrameFlow/3930ebf3-fb4c-41ef-a1aa-3e67d5b71bd4/` contains 448 samples. Input end is 10.2136934 seconds; both `mdhd` and `stts` give 10.2136167 seconds, a 0.0767 ms difference. The inspected first/last PTS match within 0.016 ms. This narrows the cumulative drift to how fragmented output uses duration; it is not evidence that all hardware encoders implement identical output metadata.

An independent, device-free container probe then reused compressed H.264 packets from that owned test recording. SourceReader and SinkWriter stayed in H.264 pass-through mode; `IMFSinkWriterEx::GetTransformForStream` confirmed no writer transform. Each case supplied the same 240 packets and deterministic variable PTS ending at 10.8 seconds. No capture, decoding or encoding occurred. With the media type explicitly declaring 60 fps, independent MP4 box parsing gives:

| Container | Submitted sample duration | Actual file duration | Difference |
| --- | --- | ---: | ---: |
| Fragmented MP4, 32 fragments | Exact variable duration | 10.8000000 s | 0 ms |
| Fragmented MP4, 32 fragments | Constant 1/60 s | 10.4000000 s | 400 ms short |
| Standard MP4 | Exact variable duration | 10.8000000 s | 0 ms |
| Standard MP4 | Constant 1/60 s | 10.7916667 s | Last sample 8.333 ms short |

The probe source is `output/container-duration-probe/MuxDurationProbe.cpp`; `fps60/` contains the four MP4 outputs and per-sample input CSVs. An earlier run using the source reader's inferred frame-rate declaration produced the same distinction at a 43,863-unit timescale. These tests establish that the fragmented sink can preserve correct submitted durations and that nominal durations reproduce the drift without an encoder. Recovering exact durations before the fragmented sink is therefore a justified candidate, but still requires validating the actual encoder's output PTS, matching and failure behavior in the full pipeline.

The old software comparison is different: `output/recording-4k-baseline-081-full/` reported only 72 successful input-frame callbacks, yet its MP4 has 615 samples, every duration exactly 1/60 second. That pipeline resampled sparse input to CFR. It can conceal this particular VFR fragment-boundary issue; neither its sample count nor its declared 60 fps establishes 60 distinct input frames per second.

Relevant documented boundaries: the [MP4 sink does not perform encoding](https://learn.microsoft.com/en-us/windows/win32/medfound/mpeg-4-file-sink), Media Foundation's [timing rules preserve known timestamps and durations](https://learn.microsoft.com/en-us/windows/win32/medfound/time-stamps-and-durations), and [minimum fragment duration](https://learn.microsoft.com/en-us/windows/win32/medfound/mf-mpeg4sink-min-fragment-duration) changes grouping rather than guaranteeing sample-duration correction. Increasing fragment length is not a demonstrated timing fix.

## Build and validation

The subsequent [exact encoded duration repair](ENCODED-SAMPLE-TIMING.md) is a separate fourth patch. It leaves this observer optional and enables the independent repair inside the hardware fragmented path by default; actual hardware output PTS must match source metadata exactly. A later controlled static test demonstrated a separate missing sample at the original periodic Flush, so confirmed hardware with normal backpressure now uses bounded metadata health checks at that maintenance point. Current source replay and binary provenance include all four ordered patches; the historical observer-only evidence above retains its original behavior and scope.

The third ordered patch is `native/vendor/frameflow-sample-diagnostics.patch`, after the existing exclusion and encoder-tuning patches. The project includes both headers and the diagnostics translation unit. A full vendor rebuild is mandatory because OutputManager's class layout changed; the custom build script rejects `-ReuseNativeObjects` rather than linking stale objects.

On 2026-09-08, 50 pure C++ checks passed with `/W4 /WX`: contiguous/gapped/overlapping/backward timestamps, failed and invalid observations, end overflow, fixed first/last retention after 10,000 samples, inclusive histogram boundaries and p95 rank behavior. A temporary Git index replaying the pinned upstream commit plus all three patches matched the then-current fork sources (`output/video-sample-diagnostics/patch-replay.txt`). That 33-source DLL build and subsequent native helper build passed. [Binary provenance](vendor/README.md) also records the later four-patch build with exact duration restoration and native clock readback. Controlled runtime observations remain separate from pure tests.
