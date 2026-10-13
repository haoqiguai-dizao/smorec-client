import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { CameraRecordingApi } from '../shared/types';
import { CameraAcquisition, type AcquiredCamera, type CameraConnectionPhase } from '../src/services/camera-acquisition';
import type { CameraFormatPreference } from '../src/services/camera-format';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let index = 0; index < 30; index++) await Promise.resolve(); }
function media(deviceId: string) {
  const track = { readyState: 'live', stops: 0, getSettings: () => ({ deviceId }), stop() { this.readyState = 'ended'; this.stops++; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}
function fixture(context: TestContext) {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const opens: { device: string; constraints: MediaStreamConstraints; result: ReturnType<typeof deferred<MediaStream>> }[] = [];
  const canceled: string[] = [], resources: AcquiredCamera[] = [], phases: CameraConnectionPhase[] = [];
  const failureCallbacks: ((error: Error) => void)[] = [];
  const failures: Error[] = [];
  let serial = 0;
  const behavior = {
    prepare: () => Promise.resolve({ id: 'lease-' + ++serial }),
    cancel: async (_id: string) => {},
    ready: async () => {},
  };
  const api = { cameraPrepare: () => behavior.prepare(), cameraCancel: (id: string) => { canceled.push(id); return behavior.cancel(id); } } as CameraRecordingApi;
  const acquisition = new CameraAcquisition({ api: () => api,
    media: constraints => {
      const video = constraints.video as MediaTrackConstraints;
      const device = (video.deviceId as ConstrainDOMStringParameters | undefined)?.exact as string ?? '';
      const result = deferred<MediaStream>(); opens.push({ device, constraints, result }); return result.promise;
    },
    recorder: (id, stream, _api, failed) => {
      const resource: AcquiredCamera = { id, stream, ready: () => behavior.ready(), start: async () => {},
        finish: async () => { stream.getTracks().forEach(track => track.stop()); },
        cancel: async () => { stream.getTracks().forEach(track => track.stop()); } };
      resources.push(resource); failureCallbacks.push(failed); return resource;
    },
    timeout: { prepare: 50, device: 100, frames: 60, cleanup: 25 },
  });
  const connect = (id: string, format?: CameraFormatPreference) => acquisition.connect(id, error => failures.push(error), phase => phases.push(phase), format);
  context.after(async () => { await acquisition.release(); });
  return { acquisition, connect, opens, canceled, resources, failures, failureCallbacks, behavior, phases };
}

test('never-resolving getUserMedia times out; retry succeeds and late old tracks are stopped', async context => {
  const f = fixture(context), old = media('old-camera'), next = media('new-camera');
  const first = assert.rejects(f.connect('old-camera'), /连接摄像头超时/);
  await flush(); assert.equal(f.opens.length, 1);
  context.mock.timers.tick(100); await first; await flush();
  assert.equal(f.acquisition.pending(), false); assert.deepEqual(f.canceled, ['lease-1']);
  const retry = f.connect('new-camera'); await flush();
  f.opens[1].result.resolve(next.stream); const active = await retry;
  f.opens[0].result.resolve(old.stream); await flush();
  assert.equal(old.track.readyState, 'ended'); assert.equal(next.track.readyState, 'live');
  assert.equal(f.acquisition.current(), active); assert.deepEqual(f.canceled, ['lease-1']);
});

test('a timed-out prepare does not block release and its late lease cannot cancel a replacement', async context => {
  const f = fixture(context), prepare = deferred<{ id: string }>();
  f.behavior.prepare = () => prepare.promise;
  const first = assert.rejects(f.connect('old-camera'), /准备超时/);
  await flush(); context.mock.timers.tick(50); await first;
  await f.acquisition.release(); assert.equal(f.opens.length, 0);
  f.behavior.prepare = async () => ({ id: 'replacement-lease' });
  const retry = f.connect('new-camera'); await flush();
  const next = media('new-camera'); f.opens[0].result.resolve(next.stream); const active = await retry;
  prepare.resolve({ id: 'late-old-lease' }); await flush();
  assert.deepEqual(f.canceled, ['late-old-lease']); assert.equal(f.opens.length, 1);
  assert.equal(f.acquisition.current(), active); assert.equal(next.track.readyState, 'live');
});

test('a stream that arrives without fresh frames is released and reports a distinct bounded failure', async context => {
  const f = fixture(context), opened = media('camera');
  f.behavior.ready = () => new Promise(() => {});
  const pending = assert.rejects(f.connect('camera'), /已连接，但没有持续送来画面/);
  await flush(); f.opens[0].result.resolve(opened.stream); await flush();
  assert.equal(f.phases.at(-1), 'frames');
  context.mock.timers.tick(60); await pending; await flush();
  assert.equal(opened.track.readyState, 'ended'); assert.deepEqual(f.canceled, ['lease-1']);
  assert.equal(f.acquisition.pending(), false);
});

test('StrictMode-style setup cleanup setup coalesces before opening a device', async context => {
  const f = fixture(context), opened = media('camera');
  const first = assert.rejects(f.connect('camera'), error => (error as Error).name === 'AbortError');
  void f.acquisition.release();
  const second = f.connect('camera');
  await flush();
  assert.equal(f.opens.length, 1); assert.deepEqual(f.canceled, []);
  f.opens[0].result.resolve(opened.stream); const active = await second; await first;
  assert.equal(active.id, 'lease-1'); assert.equal(opened.track.readyState, 'live');
});

test('rapid replacements wait for known old cleanup and only the final choice opens', async context => {
  const f = fixture(context), canceled = deferred<void>();
  f.behavior.cancel = () => canceled.promise;
  const first = assert.rejects(f.connect('first'), error => (error as Error).name === 'AbortError');
  await flush();
  const skipped = assert.rejects(f.connect('skipped'), error => (error as Error).name === 'AbortError');
  const final = f.connect('final'); await flush();
  assert.equal(f.opens.length, 1);
  canceled.resolve(); await flush();
  assert.deepEqual(f.opens.map(open => open.device), ['first', 'final']);
  const opened = media('final'); f.opens[1].result.resolve(opened.stream); const active = await final;
  await first; await skipped;
  const late = media('first'); f.opens[0].result.resolve(late.stream); await flush();
  assert.equal(late.track.readyState, 'ended'); assert.equal(f.acquisition.current(), active);
});

test('hung backend cancel cannot leave retry waiting forever', async context => {
  const f = fixture(context);
  const first = assert.rejects(f.connect('old'), error => (error as Error).name === 'AbortError');
  await flush(); f.behavior.cancel = () => new Promise(() => {});
  const retry = f.connect('new'); await flush();
  assert.equal(f.opens.length, 1);
  context.mock.timers.tick(25); await flush();
  assert.equal(f.opens.length, 2);
  const next = media('new'); f.opens[1].result.resolve(next.stream); await retry; await first;
  f.behavior.cancel = async () => {};
});

test('old recording failure close and late failure callback leave a newer camera intact', async context => {
  const f = fixture(context), old = media('old'), next = media('new');
  const first = f.connect('old'); await flush(); f.opens[0].result.resolve(old.stream); const previous = await first;
  const second = f.connect('new'); await flush(); f.opens[1].result.resolve(next.stream); const current = await second;
  await f.acquisition.release(previous.id); f.failureCallbacks[0](new Error('old failure'));
  assert.equal(f.acquisition.current(), current); assert.equal(next.track.readyState, 'live');
  assert.equal(old.track.readyState, 'ended'); assert.deepEqual(f.failures, []);
});

test('an exact-device mismatch is rejected without selecting a different input', async context => {
  const f = fixture(context), wrong = media('other');
  const pending = assert.rejects(f.connect('selected'), /设备发生变化/);
  await flush(); f.opens[0].result.resolve(wrong.stream); await pending; await flush();
  assert.equal(wrong.track.readyState, 'ended'); assert.equal(f.resources.length, 0);
  assert.deepEqual(f.opens.map(open => open.device), ['selected']);
});

test('native preference accepts a lower-resolution device without reopening or switching it', async context => {
  const f = fixture(context), opened = media('selected');
  const pending = f.connect('selected'); await flush();
  assert.deepEqual((f.opens[0].constraints.video as MediaTrackConstraints).width, { ideal: 1920, max: 1920 });
  Object.assign(opened.track, { getSettings: () => ({ deviceId: 'selected', width: 640, height: 480 }) });
  f.opens[0].result.resolve(opened.stream); const active = await pending;
  assert.equal(active.stream, opened.stream); assert.equal(f.opens.length, 1);
});

test('unsupported format retries the same exact device with compatible constraints', async context => {
  const f = fixture(context), opened = media('selected');
  const pending = f.connect('selected'); await flush();
  f.opens[0].result.reject(Object.assign(new DOMException('Unsupported frame rate', 'OverconstrainedError'), { constraint: 'frameRate' }));
  await flush(); assert.deepEqual(f.opens.map(open => open.device), ['selected', 'selected']);
  assert.deepEqual((f.opens[1].constraints.video as MediaTrackConstraints).frameRate, { ideal: 30 });
  assert.equal(f.opens[1].constraints.audio, false);
  f.opens[1].result.resolve(opened.stream); await pending;
  assert.deepEqual(f.canceled, [], 'format fallback uses the original lease');
});

test('native driver startup failure retries only the selected device once before native negotiation', async context => {
  const f = fixture(context), opened = media('selected');
  const pending = f.connect('selected'); await flush();
  f.opens[0].result.reject(new DOMException('Timeout starting video source', 'AbortError'));
  await flush(); assert.deepEqual(f.opens.map(open => open.device), ['selected', 'selected']);
  assert.deepEqual(f.opens[1].constraints, { audio: false, video: { deviceId: { exact: 'selected' }, resizeMode: { exact: 'none' } } });
  f.opens[1].result.resolve(opened.stream); assert.equal((await pending).stream, opened.stream);
});

test('failed native retry is bounded and reported instead of swallowed as cancellation', async context => {
  const f = fixture(context), failure = new DOMException('Timeout starting video source', 'AbortError');
  const pending = assert.rejects(f.connect('selected'), error => error === failure);
  await flush(); f.opens[0].result.reject(failure); await flush(); f.opens[1].result.reject(failure);
  await pending; await flush(); assert.equal(f.opens.length, 2); assert.equal(f.acquisition.pending(), false);
});

test('native recovery never downgrades an explicit format or chooses an unspecified default camera', async context => {
  const f = fixture(context), failure = new DOMException('driver timeout', 'AbortError');
  for (const [id, format] of [['selected', { resolution: '2160p', fps: 60 }], ['', { resolution: 'auto', fps: 30 }]] as const) {
    const count = f.opens.length, pending = assert.rejects(f.connect(id, format), error => error === failure);
    await flush(); f.opens[count].result.reject(failure); await pending; await flush();
    assert.equal(f.opens.length, count + 1);
  }
});

test('permission failures and missing explicit devices never trigger a format fallback', async context => {
  const f = fixture(context);
  for (const error of [new DOMException('Denied', 'NotAllowedError'),
    Object.assign(new DOMException('Missing selected camera', 'OverconstrainedError'), { constraint: 'deviceId' })]) {
    const count = f.opens.length;
    const rejected = assert.rejects(f.connect('selected'), candidate => candidate === error);
    await flush(); f.opens[count].result.reject(error); await rejected; await flush();
    assert.equal(f.opens.length, count + 1);
  }
});

test('a canceled camera attempt cannot reopen through the compatibility fallback', async context => {
  const f = fixture(context);
  const rejected = assert.rejects(f.connect('selected'), error => (error as Error).name === 'AbortError');
  await flush(); await f.acquisition.release();
  f.opens[0].result.reject(Object.assign(new DOMException('Unsupported format', 'OverconstrainedError'), { constraint: 'width' }));
  await rejected; await flush(); assert.equal(f.opens.length, 1);
});

test('an unsupported explicit 4K mode fails without reopening the device at a smaller size', async context => {
  const f = fixture(context);
  const error = Object.assign(new DOMException('Unsupported resolution', 'OverconstrainedError'), { constraint: 'width' });
  const rejected = assert.rejects(f.connect('selected', { resolution: '2160p', fps: 60 }), reason => reason === error);
  await flush(); f.opens[0].result.reject(error); await rejected; await flush();
  assert.equal(f.opens.length, 1); assert.equal(f.resources.length, 0);
});

test('oversized native frames are released before creating a recorder', async context => {
  const f = fixture(context), opened = media('selected');
  Object.assign(opened.track, { getSettings: () => ({ deviceId: 'selected', width: 8192, height: 8192 }) });
  const rejected = assert.rejects(f.connect('selected'), /超过支持范围/);
  await flush(); f.opens[0].result.resolve(opened.stream); await rejected; await flush();
  assert.equal(opened.track.readyState, 'ended'); assert.equal(f.resources.length, 0);
});

test('cancel during native format negotiation stops the source and ignores late completion', async context => {
  const f = fixture(context), opened = media('selected'), configuring = deferred<void>();
  let calls = 0;
  Object.assign(opened.track, { getCapabilities: () => ({ width: { max: 3840 }, height: { max: 2160 } }),
    getSettings: () => ({ deviceId: 'selected', width: 3840, height: 2160 }),
    applyConstraints: () => { calls++; return configuring.promise; } });
  const rejected = assert.rejects(f.connect('selected'), reason => (reason as Error).name === 'AbortError');
  await flush(); f.opens[0].result.resolve(opened.stream); await flush();
  assert.equal(calls, 1); await f.acquisition.release(); await rejected;
  configuring.resolve(); await flush();
  assert.equal(calls, 1); assert.equal(opened.track.readyState, 'ended'); assert.equal(f.resources.length, 0);
});

test('recording input replacement retains the encoding lease and retires the old source only after acceptance', async context => {
  const f = fixture(context), old = media('old'), next = media('next'), accepted = deferred<void>();
  const connecting = f.connect('old'); await flush(); f.opens[0].result.resolve(old.stream); const active = await connecting;
  Object.assign(active, { sourceStream: old.stream, replace: async (stream: MediaStream) => {
    await accepted.promise; old.track.stop(); Object.assign(active, { sourceStream: stream });
  } });
  const switching = f.acquisition.replace('next', { resolution: 'auto', fps: 30 });
  await flush(); f.opens[1].result.resolve(next.stream); await flush();
  assert.equal(old.track.readyState, 'live'); assert.deepEqual(f.canceled, []);
  accepted.resolve(); assert.equal(await switching, active);
  assert.equal(active.sourceStream, next.stream); assert.equal(old.track.readyState, 'ended');
  assert.equal(active.id, 'lease-1'); assert.deepEqual(f.canceled, []);
  Object.assign(active, { cancel: async () => next.track.stop() });
});

test('failed and timed-out recording replacements preserve the old input and stop late candidate tracks', async context => {
  const f = fixture(context), old = media('old'), bad = media('other'), late = media('late');
  const connecting = f.connect('old'); await flush(); f.opens[0].result.resolve(old.stream); const active = await connecting;
  Object.assign(active, { replace: async () => { throw new Error('no frames'); } });
  const mismatch = assert.rejects(f.acquisition.replace('selected', { resolution: 'auto', fps: 30 }));
  await flush(); f.opens[1].result.resolve(bad.stream); await mismatch;
  assert.equal(bad.track.readyState, 'ended'); assert.equal(old.track.readyState, 'live');
  const timeout = assert.rejects(f.acquisition.replace('late', { resolution: 'auto', fps: 30 }), /超时/);
  await flush(); context.mock.timers.tick(100); await timeout;
  f.opens[2].result.resolve(late.stream); await flush();
  assert.equal(late.track.readyState, 'ended'); assert.equal(f.acquisition.current(), active);
  assert.equal(old.track.readyState, 'live'); assert.deepEqual(f.canceled, []);
});

test('recording replacement negotiates an unsupported automatic format on the same exact candidate device', async context => {
  const f = fixture(context), old = media('old'), next = media('new');
  const connecting = f.connect('old'); await flush(); f.opens[0].result.resolve(old.stream); const active = await connecting;
  Object.assign(active, { replace: async (stream: MediaStream) => { old.track.stop(); Object.assign(active, { sourceStream: stream }); }, cancel: async () => next.track.stop() });
  const switching = f.acquisition.replace('new', { resolution: 'auto', fps: 30 }); await flush();
  f.opens[1].result.reject(Object.assign(new DOMException('Unsupported', 'OverconstrainedError'), { constraint: 'frameRate' }));
  await flush(); assert.deepEqual(f.opens.slice(1).map(value => value.device), ['new', 'new']);
  assert.equal(old.track.readyState, 'live'); f.opens[2].result.resolve(next.stream); await switching;
  assert.equal(f.acquisition.current(), active); assert.equal(old.track.readyState, 'ended'); assert.deepEqual(f.canceled, []);
});
