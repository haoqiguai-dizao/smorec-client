import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudioApi } from '../shared/types';
import { WebcamRecorder } from '../src/services/webcam-recorder';
import type { WebcamFrames } from '../src/services/webcam-frame-monitor';

class FakeTrack extends EventTarget {
  readyState = 'live';
  getSettings() { return { width: 1920, height: 1080, frameRate: 30 }; }
  stop() { this.readyState = 'ended'; }
  disconnect() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); }
}
class FakeRecorder extends EventTarget {
  static latest: FakeRecorder;
  static isTypeSupported() { return true; }
  state = 'inactive';
  get mimeType() { return this.options.mimeType ?? ''; }
  constructor(_stream: MediaStream, readonly options: MediaRecorderOptions) { super(); FakeRecorder.latest = this; }
  start() { this.state = 'recording'; queueMicrotask(() => this.dispatchEvent(new Event('start'))); }
  data(data = new Blob([new Uint8Array([1, 2, 3])])) { this.dispatchEvent(Object.assign(new Event('dataavailable'), { data })); }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => { this.data(); this.dispatchEvent(new Event('stop')); });
  }
  unexpectedStop() { this.state = 'inactive'; this.dispatchEvent(new Event('stop')); }
}
async function fixture(run: (context: { track: FakeTrack; recorder: WebcamRecorder; calls: string[]; failures: Error[]; frames: WebcamFrames; api: StudioApi }) => Promise<void>, writeFails = false) {
  const original = globalThis.MediaRecorder;
  Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: FakeRecorder });
  const track = new FakeTrack(), calls: string[] = [], failures: Error[] = [];
  const api = {
    cameraStarted: async () => { calls.push('started'); },
    cameraAppend: async () => { calls.push('append'); if (writeFails) throw new Error('磁盘空间不足'); },
    cameraFinish: async () => { calls.push('finish'); },
    cameraCancel: async () => { calls.push('cancel'); },
  } as unknown as StudioApi;
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  const frames: WebcamFrames = { ready: async () => {}, watch: () => {}, dispose: () => {} };
  const recorder = new WebcamRecorder('test', stream, api, error => failures.push(error), frames);
  try { await run({ track, recorder, calls, failures, frames, api }); }
  finally { await recorder.cancel(false); Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, writable: true, value: original }); }
}

test('camera disconnect reports immediately once and cancels only the camera session', async () => {
  await fixture(async ({ track, recorder, calls, failures }) => {
    await recorder.start(); track.disconnect(); track.disconnect();
    await recorder.cancel();
    assert.equal(failures.length, 1); assert.match(failures[0].message, /断开/);
    assert.equal(calls.filter(call => call === 'cancel').length, 1);
    assert.equal(track.readyState, 'ended'); assert.ok(!calls.includes('finish'));
  });
});
test('unexpected recorder stop is detected without requiring an error event', async () => {
  await fixture(async ({ recorder, calls, failures }) => {
    await recorder.start(); FakeRecorder.latest.unexpectedStop(); await recorder.cancel();
    assert.equal(failures.length, 1); assert.match(failures[0].message, /意外结束/); assert.ok(calls.includes('cancel'));
  });
});
test('first IPC write failure reports immediately and prevents later writes', async () => {
  await fixture(async ({ recorder, calls, failures, track }) => {
    await recorder.start(); FakeRecorder.latest.data();
    await new Promise(resolve => setImmediate(resolve));
    await recorder.cancel(); FakeRecorder.latest.data();
    assert.equal(failures.length, 1); assert.match(failures[0].message, /磁盘空间不足/);
    assert.equal(calls.filter(call => call === 'append').length, 1); assert.equal(track.readyState, 'ended');
  }, true);
});
test('normal finish waits for the final dataavailable write before marking the camera complete', async () => {
  await fixture(async ({ recorder, calls, failures }) => {
    await recorder.start();
    assert.ok(FakeRecorder.latest.options.videoBitsPerSecond! >= 8_000_000, '1080p recording retains enough bitrate for source detail');
    await recorder.finish();
    assert.deepEqual(calls, ['started', 'append', 'finish']); assert.equal(failures.length, 0);
  });
});
test('cancel ignores late dataavailable and is idempotent', async () => {
  await fixture(async ({ recorder, calls, failures }) => {
    await recorder.start(); await Promise.all([recorder.cancel(), recorder.cancel()]);
    FakeRecorder.latest.data();
    assert.deepEqual(calls, ['started', 'cancel']); assert.equal(failures.length, 0);
  });
});

test('recording cannot acknowledge camera start before continuous source frames are ready', async () => {
  await fixture(async ({ recorder, calls, frames }) => {
    let ready!: () => void;
    frames.ready = () => new Promise<void>(resolve => { ready = resolve; });
    const starting = recorder.start();
    await Promise.resolve(); assert.deepEqual(calls, []);
    ready(); await starting; assert.deepEqual(calls, ['started']);
    await recorder.finish();
  });
});

test('cancel while waiting for source frames never starts MediaRecorder', async () => {
  await fixture(async ({ recorder, calls, frames }) => {
    let ready!: () => void;
    frames.ready = () => new Promise<void>(resolve => { ready = resolve; });
    const starting = recorder.start();
    const rejected = assert.rejects(starting, /取消/);
    await recorder.cancel(); ready(); await rejected;
    assert.deepEqual(calls, ['cancel']);
  });
});

test('actual MIME acknowledgement gates all encoded bytes without shifting the start-event clock', async context => {
  let now = 10_000; context.mock.method(Date, 'now', () => now);
  await fixture(async ({ recorder, api, calls }) => {
    let acknowledge!: () => void;
    const gate = new Promise<void>(resolve => { acknowledge = resolve; });
    let timestamp = 0, mime: string | undefined;
    api.cameraStarted = async (_id, startedAt, actual) => { timestamp = startedAt; mime = actual; calls.push('started'); await gate; };
    const starting = recorder.start(); await new Promise(resolve => setImmediate(resolve));
    now = 14_000; FakeRecorder.latest.data(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['started']); assert.equal(timestamp, 10_000); assert.equal(mime, 'video/mp4;codecs=avc1');
    acknowledge(); await starting; await recorder.finish();
    assert.equal(calls.filter(call => call === 'append').length, 2);
  });
});

test('cancel during MIME acknowledgement releases a queued chunk without writing or hanging', async () => {
  await fixture(async ({ recorder, api, calls }) => {
    api.cameraStarted = () => new Promise(() => {});
    const rejected = assert.rejects(recorder.start(), /取消/);
    await new Promise(resolve => setImmediate(resolve)); FakeRecorder.latest.data();
    await recorder.cancel(); await rejected;
    assert.deepEqual(calls, ['cancel']);
  });
});

test('large MP4 blobs are written in bounded ordered IPC chunks before the final flush', async () => {
  await fixture(async ({ recorder, api }) => {
    const sizes: number[] = [], lastBytes: number[] = [];
    api.cameraAppend = async (_id, bytes) => { sizes.push(bytes.byteLength); lastBytes.push(new Uint8Array(bytes).at(-1)!); };
    await recorder.start();
    FakeRecorder.latest.data(new Blob([new Uint8Array(8 * 1024 * 1024), new Uint8Array([9, 10])]));
    await recorder.finish();
    assert.deepEqual(sizes, [8 * 1024 * 1024, 2, 3]); assert.deepEqual(lastBytes, [0, 10, 3]);
  });
});

test('synchronous start failure before any output retries VP8 with one MIME acknowledgement', async context => {
  const original = FakeRecorder.prototype.start;
  context.mock.method(FakeRecorder.prototype, 'start', function (this: FakeRecorder) {
    if (this.mimeType.startsWith('video/mp4')) throw new Error('MP4 encoder unavailable');
    original.call(this);
  });
  await fixture(async ({ recorder, api, calls }) => {
    let actual: string | undefined;
    api.cameraStarted = async (_id, _time, mime) => { calls.push('started'); actual = mime; };
    await recorder.start(); assert.equal(actual, 'video/webm;codecs=vp8');
    await recorder.finish(); assert.deepEqual(calls, ['started', 'append', 'finish']);
  });
});

test('a failure after a start event cannot switch the recording container', async context => {
  let attempts = 0;
  context.mock.method(FakeRecorder.prototype, 'start', function (this: FakeRecorder) {
    attempts++; this.state = 'recording'; this.dispatchEvent(new Event('start'));
    throw new Error('Encoder failed after start');
  });
  await fixture(async ({ recorder, calls }) => {
    await assert.rejects(recorder.start(), /Encoder failed after start/); await recorder.cancel();
    assert.equal(attempts, 1); assert.ok(!calls.includes('append'));
  });
});
