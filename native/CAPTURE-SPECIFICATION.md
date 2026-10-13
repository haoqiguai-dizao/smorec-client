# Capture dimensions and frame rate

`RecordingOptions.Resolution` defaults to `native`, including protocol clients that omit the new field. The source monitor/window or the validated capture crop determines the input dimensions. `CaptureSpecification.Resolve` applies the requested policy once before starting capture:

| Policy | Maximum long edge | Example: 3840 × 2160 source |
| --- | ---: | --- |
| `native` | No automatic scaling | 3840 × 2160 |
| `2160p` | 3840 | 3840 × 2160 |
| `1440p` | 2560 | 2560 × 1440 |
| `1080p` | 1920 | 1920 × 1080 |

Presets only downscale and retain the source aspect ratio, including portrait and ultrawide sources. Source dimensions are first rounded down to even pixels, then scaled and rounded down to even output pixels for H.264, matching the launcher calculation. A 853 × 481 native source becomes 852 × 480; 3841 × 2160 with `1080p` becomes 1920 × 1080. Frame rate remains the user's separate 30 or 60 FPS choice; requesting native resolution does not silently alter it. Existing recordings and their dimensions are unchanged.

Source dimensions must each be 2–16384 pixels. Resolved output must have dimensions of 2–8192 pixels and no more than 33,177,600 pixels (8K UHD). These are application resource budgets, not a guarantee that a particular encoder accepts every size. An original source exceeding the output budget is rejected with a message asking for a lower resolution or smaller crop; it is never silently reduced. A large valid source can still use a downsampling preset. Unknown/null policies and collapsed output dimensions are rejected.

For controlled diagnostics, `FRAMEFLOW_CAPTURE_MAX_EDGE=640..8192` explicitly overrides the selected policy. It never upscales; invalid, empty, negative or fractional values fail validation. The start diagnostic records both source bounds and resolved output dimensions, crop, policy, FPS and the override. Native results and recovery manifests retain the resolved output dimensions for the editor.

## Performance and timing boundaries

Native 4K output bypasses the former GPU downscale to 1080p, but subsequent GPU copies, color conversion and H.264 encoding process four times as many pixels. The existing two-worker software-encoder selection was measured at 1080p60, not validated as a universal 4K policy. Quality-based VBR is preserved; its mean-bit-rate configuration does not impose an actual bitrate cap in that mode. Neither hardware selection nor sink-writer flush behavior is changed by the resolution implementation.

The hardware diagnostic previously produced an 11.589-second stream for 12.150 seconds of capture elapsed time. Subsequent sample and container probes isolated duration handling at fragment boundaries, and a separate static long test demonstrated an original periodic Flush discarding one pending sample. The independent [exact encoded timing repair](ENCODED-SAMPLE-TIMING.md) addresses both while retaining fragmented recovery. Following controlled static/animated three-minute and crash-recovery checks, the helper prefers hardware with software startup fallback; explicit `FRAMEFLOW_CAPTURE_ENCODER=software` remains available. These encoder changes are separate from the pure dimension policy. See [software fallback tuning](vendor/ENCODER-TUNING.md).

## Verification

The pure native suite covers 4K, portrait, ultrawide, lower-resolution sources, odd native/preset dimensions, each preset, legacy protocol defaults, diagnostic overrides, source/output budgets and invalid input. The September 8 implementation passes 113 native checks without device activation.

Media validation must separately use dedicated 3840 × 2160 sources, fully decode the saved media and verify source/project/export dimensions and timeline agreement. Existing `smoke-capture.ps1` can target `test-window.ps1 -PhysicalWidth 3840 -PhysicalHeight 2160 -Borderless` by its exact title/HWND. The combined performance harness now accepts source dimensions, resolution, animated/static/sparse content and bounded native-memory monitoring. The exact-timing document records its 4K60 static/animated long results and software comparison; other frame rates and drivers need separate coverage. A successful resolution unit test or a smooth exported recording does not demonstrate responsive remote or local desktop interaction during recording.

- [Microsoft H.264 encoder properties](https://learn.microsoft.com/en-us/windows/win32/medfound/h-264-video-encoder)
- [Microsoft sink-writer flush semantics](https://learn.microsoft.com/en-us/windows/win32/api/mfreadwrite/nf-mfreadwrite-imfsinkwriter-flush)
