# Recording input latency diagnostics

## Current asynchronous backend

The current candidate replaces the global low-level mouse hook with a dedicated Raw Input message window. `FRAMEFLOW_CAPTURE_MOUSE_BACKEND=raw` is the default; `poll` explicitly selects button-state polling and can miss a press/release entirely between samples. `FRAMEFLOW_CAPTURE_MOUSE_HOOK=off` takes precedence and disables click capture while retaining position/shape sampling. No setting re-enables a low-level hook in the candidate.

`cursor-input-diagnostics` records the selected backend, `hookEnabled=false`, registration/readback/removal state, input-thread exit, packet/button/queue/drop/error counts and coarse message age. Raw registration must read back `RIDEV_INPUTSINK` (`256`) with the owned message HWND, and be absent after stop. No `NOLEGACY` or `CAPTUREMOUSE` flags are used. `hDevice=0` is accepted. Coordinates come from `MSG.pt`; click time remains the consumption QPC clock, so queue delay can still affect recorded click timing. Message-age counters are coarse DWORD-millisecond observations, not hardware latency.

Input parsing, overflow and position availability failures are surfaced once as auxiliary warnings without discarding otherwise valid video. Journal failures remain fatal. Diagnostics contain aggregate metadata, not extra user trajectories. Pure parser/queue tests and the explicit `--mouse-lifecycle` native test entry are separate from physical-device validation. See design and acceptance boundaries（内部历史资料未纳入本快照）.

## Frozen 0.9.4 and Earlier Hook Diagnostics

The remainder documents the former implementation and frozen comparison packages, not the current default. `InputLatencyDiagnostics` remains a historical aggregate helper with pure tests; the current mouse collector does not call it.

Detailed timing is opt-in. It exists to distinguish the native mouse hook's arrival delay, our callback work, and time spent waiting for later hooks in Windows. It does not establish a root cause without controlled recording comparisons.

| Environment variable | Behavior |
| --- | --- |
| `FRAMEFLOW_CAPTURE_INPUT_DIAGNOSTICS=1` | Enables fixed-size latency histograms during recording. |
| Unset or another value | No extra per-event timestamp reads or histogram updates. |
| `FRAMEFLOW_CAPTURE_MOUSE_HOOK=off` | Diagnostic comparison only: skips the global click hook, while keeping 60 Hz position/shape sampling. Click markers are unavailable for that recording. |
| Hook override unset | Existing low-level click hook and message loop are retained. |

At stop/dispose, `capture.log` gets at most one `cursor-input-diagnostics` record through `SessionDiagnostics`. It contains `hookEnabled`, `detailsEnabled`, `hookThreadExited`, and the timing distributions when enabled. It never logs per-event timing lines, mouse button codes, input text, or additional screen/audio data. The recording's existing cursor track is unchanged except when the explicit hook-off diagnostic suppresses click capture.

`InputLatencyDiagnostics.cs` stores only aggregate counters and fixed buckets. Its callback path performs no file operations, sorting, allocations, or blocking locks. Snapshot allocation/percentile calculation happens when stopping. Existing click enqueueing and `CallNextHookEx` forwarding stay intact.

## Metrics

- `eventArrival`: unsigned DWORD millisecond difference between `Environment.TickCount` at callback entry and `MSLLHOOKSTRUCT.time`. Arithmetic handles the 49.7-day wrap; future/implausibly old timestamps are counted under `invalidEventTimes` instead of generating multi-day latency values. Arrival is a coarse OS-clock measurement, not hardware-to-photon latency.
- `ownCallback`: elapsed high-resolution stopwatch time from instrumented callback entry through event-time reading and our original click queue work, before `CallNextHookEx`.
- `nextHookChain`: stopwatch time spent inside `CallNextHookEx`. This includes downstream hook processing/scheduling, so it must not be attributed entirely to this app.
- Histogram aggregation itself occurs after forwarding and is not included in `ownCallback`; enabling detailed diagnostics adds a small measurement cost and must be held constant across compared runs.

Each distribution reports sample count, mean, actual maximum, p50/p95/p99 **bucket upper bounds**, bucket limits, and counts. Bucket bounds in milliseconds are 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 33, 66, 100, 250, 500 and 1000; a final null bound represents overflow. Overflow percentile estimates use the observed maximum. Empty distributions have null summaries rather than falsely reporting zero latency.

Read finalized distributions only when `hookThreadExited=true`. If the existing bounded hook join times out, the record preserves that fact and the snapshot may be partial. An apparent lack of callbacks does not prove the hook is healthy: Windows may silently remove a timed-out low-level hook.

## Interpretation and validation

Current source uses a dedicated message-loop thread, with only timestamp/queue work for click-down events and immediate forwarding for movement. Disk journaling and 60 Hz position sampling run on a separate task; screen recording uses cached monitor bounds. No definite blocking operation was found inside the original callback.

However, `WH_MOUSE_LL` runs synchronously in the thread that installed it before input reaches the target queue. CPU contention, scheduling pauses or downstream hooks can therefore delay input even if the callback's own work is short. This is an architectural risk, not a measured explanation of the user's lag. Microsoft recommends short callbacks on a dedicated thread and notes that Raw Input can monitor input asynchronously more efficiently. A later Raw Input migration would need its own remote/injected-input compatibility validation.

Compare identical screen/camera/effects content and fps, first with detailed timing enabled, then with the hook-off diagnostic while preserving all other settings. Also measure the controlled target app's input/render latency and per-process CPU. A hook-off improvement can justify further isolation; software-encoder throughput or low CPU alone cannot prove cursor responsiveness.

Pure tests in `FrameFlow.Capture.Tests/InputLatencyDiagnosticsTests.cs` cover tick wrap, future timestamps, empty metrics, histogram boundaries/overflow, separate callback/chain timing, and concurrent counter integrity. They activate no devices and install no hook. Runtime hook lifecycle and recording performance require the controlled comparison separately.

## Official references

- [LowLevelMouseProc callback, threading and timeout behavior](https://learn.microsoft.com/en-us/windows/win32/winmsg/lowlevelmouseproc)
- [MSLLHOOKSTRUCT event timestamp](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-msllhookstruct)
- [Raw Input overview and asynchronous delivery](https://learn.microsoft.com/en-us/windows/win32/inputdev/about-raw-input)
