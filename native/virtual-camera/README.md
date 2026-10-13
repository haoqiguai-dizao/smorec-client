# XiaoLu virtual camera (Windows x64)

This is a self-contained, user-mode DirectShow capture source and an independent BGRA producer bridge. The implementation was written against Windows SDK COM interfaces; it does not copy or link OBS code, DirectShow BaseClasses, or other third-party virtual camera implementations. OBS's general producer/shared-memory/camera architecture informed the integration design. This statement describes this module's sources, not a legal conclusion about unrelated project dependencies.

Microsoft treats DirectShow as legacy and recommends Media Foundation where possible. DirectShow was selected here to validate compatibility with desktop broadcasting applications that accept DirectShow cameras, across the application's existing Windows 10/11 support baseline. References: [capture pin requirements](https://learn.microsoft.com/en-us/windows/win32/directshow/pin-requirements-for-capture-filters), [IAMStreamConfig](https://learn.microsoft.com/en-us/windows/win32/api/strmif/nn-strmif-iamstreamconfig), [IFilterMapper2::RegisterFilter](https://learn.microsoft.com/en-us/windows/win32/api/strmif/nf-strmif-ifiltermapper2-registerfilter).

## Build

From the repository root, after preparing the existing local Microsoft toolchain:

```powershell
./scripts/build-virtual-camera.ps1
node native/virtual-camera/verify-protocol.mjs
```

The build uses the existing `native/tools/enter-toolchain.ps1`, MSVC 14.44 and SDK 10.0.26100.0. It performs a clean translation-unit compile, statically links the MSVC runtime, and outputs:

- `native/virtual-camera/bin/x64/XiaoLu.VirtualCamera.dll`
- `native/virtual-camera/bin/x64/XiaoLu.CameraBridge.exe`

The DLL and EXE must remain together in a stable install directory. Do not distribute `.lib`, `.exp` or `obj` files. The current locally provisioned toolchain only includes x64 libraries, so this build supports **x64 receiving applications**. A 32-bit receiver needs a separate x86 DLL/build and 32-bit registration; that has not been implemented or claimed. This is not a Windows kernel driver and does not require a kernel-mode driver-signing exemption.

## Application integration

The device is named **小录 Virtual Camera**. Its independent CLSID is `{7D90FA14-1584-4E97-9437-0C9DE4E752CB}`. It never registers under OBS's name or CLSID.

Launch the bridge with `windowsHide: true`, redirected stdin/stdout/stderr, and without a shell:

```text
XiaoLu.CameraBridge.exe stream --width 1920 --height 1080 --fps 30
```

Supported producer sizes are `1920×1080`, `1080×1920`, `1280×720`, and `720×1280`, at exactly 30 FPS. stdin contains contiguous **top-down BGRA8** frames, each exactly `width * height * 4` bytes, without a header or line breaks. The producer dimensions remain fixed until EOF; start a new bridge process to change them. HTML canvas RGBA must be converted to BGRA before writing. Alpha is not composed by the camera: flatten the background upstream and send opaque pixels.

stdout is UTF-8 JSON Lines. The initial readiness response is:

```json
{"event":"ready","width":1920,"height":1080,"fps":30,"pixelFormat":"BGRA","frameBytes":8294400}
```

A single producer owns a session-scoped writer mutex. Starting another returns an `error` event with `stage: "stream-start"`, code `170` (`ERROR_BUSY`), and exit code 1. Unsupported dimensions/FPS use Win32 code 87. Invalid options, incomplete frames and failed pipe reads likewise emit an explicit error and exit nonzero.

The application must honor stdin backpressure and keep a bounded queue; this bridge cannot remove already queued bytes from its input pipe. For low latency, allow at most one in-flight frame and discard newer render submissions until that write drains. Closing stdin cleanly marks the feed inactive and emits:

```json
{"event":"stopped","frames":150,"dropped":0}
```

An EOF in the middle of a frame returns code 13 (`ERROR_INVALID_DATA`) instead of accepting damaged data. Shared-memory acquisition has an 8 ms timeout: a slow consumer causes that producer frame to be dropped, rather than blocking desktop capture indefinitely. Occasional `reader-busy` warning events carry the cumulative drop count. Timestamps use monotonic Windows uptime. Frames older than two seconds, an absent producer, or a stopped stream output an opaque black frame; they do not keep presenting the last private screen forever.

The camera advertises NV12 and bottom-up RGB32 for all four output dimensions via `IAMStreamConfig`, with `IKsPropertySet` reporting `PIN_CATEGORY_CAPTURE`. NV12 conversion uses BT.709 limited range. If the receiver selects dimensions that differ from the producer, the image is resized proportionally with black letterboxing, without stretching. Receiver format selection remains under the receiving application; choose the matching portrait format there for a full portrait canvas. The filter supplies samples on a 30 FPS schedule, drops missed delivery slots, and timestamps on the graph clock when one is available. This is an output schedule, not a claim that every upstream machine can render 30 distinct frames per second.

## Explicit installation and removal

Normal application startup, `status`, `stream`, builds and tests do **not** register anything. Show installation as an explicit user action in the app and invoke:

```text
XiaoLu.CameraBridge.exe install --elevate
XiaoLu.CameraBridge.exe uninstall --elevate
```

`--elevate` requests Windows UAC approval only if necessary, starts the trusted same-directory bridge with the appropriate verb, waits for its exit, then prints the resulting status. Cancelling UAC returns an `elevation` error with Win32 code 1223. Without `--elevate`, a non-administrator receives code 740 and no registry mutation. When already elevated, `install`/`uninstall` can be used directly by an installer.

Registration writes the module's own CLSID under machine-wide `Software\Classes\CLSID` and its device entry under the DirectShow video-input category. No OBS configuration, services or other camera devices are changed. Stop applications using this DLL before replacing or removing it; loaded camera modules may be locked until those receiving applications exit. Register after placing the DLL at its final path, and unregister before removing that path.

Both uninstall entry points first read the x64 machine-wide class path. No registration returns success immediately without UAC. Strict `uninstall` rejects another installation's path with `ERROR_INVALID_OWNER` and does not remove it. `uninstall-if-owned --elevate` instead reports `different-installation` and succeeds without mutation for a foreign path, so an older application's removal cannot break a newer installation. The elevated DLL rechecks path ownership immediately before unregistering under a shared registration mutex; direct `DllUnregisterServer` calls receive the same protection. Only absolute normalized paths are accepted; a matching basename or directory prefix never establishes ownership.

The NSIS `customUnInstall` hook calls `uninstall-if-owned --elevate` **before deleting any installed files** on an actual uninstall. The inspected electron-builder 26.15.3 upgrade path supplies `--updated`, and that path skips camera cleanup to preserve registration while replacing the application. UAC cancellation, child-process failure/timeout, or a DLL whose cleanup helper is missing aborts before file removal. An old installation with no camera component proceeds. The application uninstall therefore preserves its files if registered-camera cleanup cannot finish; retry after completing approval or repairing the installation.
The read-only command is:

```text
XiaoLu.CameraBridge.exe status
```

It returns `{installed, compatible, architecture, registeredPath, dllPath, elevated}`. `installed` means the x64 machine-wide COM class path exists. `compatible` additionally means the registered path matches this adjacent DLL and the file exists; it is **not** a compatibility certification for a particular broadcaster. Do not treat a missing x64 registration as proof about another registry architecture.

## Shared-memory contract

`protocol.hpp` is the canonical v1 ABI. The names are session-local `XiaoLu.VirtualCamera.Frames.v1`, `XiaoLu.VirtualCamera.FrameGate.v1` and `XiaoLu.VirtualCamera.Writer.v1`. Mapping layout is a fixed 64-byte, 8-byte-aligned header followed by at most 8,294,400 bytes of BGRA pixels. The header contains magic/version/size/capacity, producer dimensions/FPS/active, sequence, monotonic milliseconds, and writer PID. Readers validate the header and supported dimensions before copying. Named objects use the current process's default Windows security descriptor, and the consumer only maps the pixels with read access.

All multi-field reads/writes are under the named mutex; frame copies and header publication are atomic to readers. Readers retry opening an absent channel every 500 ms. Mutex timeouts can produce a black frame for that read, and a stopped/abandoned producer is recoverable by a new producer. This CPU-copy baseline deliberately avoids GPU-specific shared texture handles; profile it before expanding resolution or frame rate.

## Verification and remaining acceptance

`self-test` loads the adjacent DLL directly and asks its class factory for a filter. It builds an actual DirectShow graph with the Windows Sample Grabber and Null Renderer without registering XiaoLu. It verifies eight output formats, capture delivery, increasing timestamps, buffer size, pixel content, pause/resume without timestamp rollback, stop, graph teardown and COM unloadability. `self-test --require-live` expects an actively refreshed **constant test image** in the producer channel.

`verify-protocol.mjs` supplies directional color gradients through a separate BGRA producer process, verifies every input dimension against all eight output formats, tests producer exclusivity, truncated/unsupported input, two-second stale fallback, and unchanged registration state. The 2026-09-08 local run passed 400 continuous-frame comparisons with pause/resume plus the stale-output checks. The build passed `/W4` without compiler warnings. None of these checks registers a system camera.

The ownership self-test covers ten path cases, including case/separator normalization, directory aliases, other drives/install folders, relative and quoted paths. `tests/verify-uninstall.ps1` compiles a no-registry/no-UAC helper substitute, then compiles and executes the shipping NSIS macro in six isolated scenarios: success, failure, simulated UAC cancellation, upgrade preservation, missing helper with a remaining DLL, and an older installation without a camera. It asserts the local upstream hook order and `--updated` argument contract. The local 2026-09-08 run passed; application files outside its output fixture directories were untouched. Real `uninstall` and `uninstall-if-owned` were also checked against the existing unregistered state and returned success with `elevated: false`.

```powershell
./native/virtual-camera/tests/verify-uninstall.ps1
```

Still required for release acceptance: explicit device installation/removal and upgrade on a test system; recognition and actual display in the installed x64 Douyin and Xiaohongshu broadcasting tools; sustained performance under real screen/webcam/effects load; receiver restart/reselection behavior; and real microphone/system-audio synchronization. This module outputs video only. The DirectShow Sample Grabber tests establish the native transport and filter behavior, not completion of those platform tests.
