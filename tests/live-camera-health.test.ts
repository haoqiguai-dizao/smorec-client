import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveCamera } from '../src/services/live/camera';

function fixture(t: test.TestContext) {
  let now = 0, sequence = 0, plays = 0, pauses = 0;
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  const video = { muted: false, playsInline: false, style: {}, readyState: 4, srcObject: null,
    play: () => { plays++; return Promise.resolve(); }, pause: () => { pauses++; },
    requestVideoFrameCallback: (callback: VideoFrameRequestCallback) => { callbacks.set(++sequence, callback); return sequence; },
    cancelVideoFrameCallback: (id: number) => callbacks.delete(id), setAttribute: () => {}, remove: () => {},
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true,
    value: { createElement: () => video, body: { append: () => {} } } });
  t.mock.method(performance, 'now', () => now);
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); });
  const issues: string[] = [], camera = new LiveCamera(issue => issues.push(issue));
  const track = { readyState: 'live', muted: false }, stream = { getVideoTracks: () => [track] } as unknown as MediaStream;
  const frame = (time: number) => {
    const [id, callback] = callbacks.entries().next().value!; callbacks.delete(id);
    callback(now, { mediaTime: time } as VideoFrameCallbackMetadata);
  };
  t.after(() => camera.dispose());
  return { camera, video, track, stream, issues, frame, clock: (time: number) => { now = time; },
    plays: () => plays, pauses: () => pauses };
}

test('a retained frame or repeated media timestamp cannot masquerade as a recovered camera', t => {
  const f = fixture(t); f.camera.current(f.stream, 0);
  f.frame(0); f.frame(0); assert.equal(f.camera.current(f.stream, 1), undefined);
  f.clock(6000); f.camera.current(f.stream, 6000);
  assert.deepEqual(f.issues, ['camera-unavailable']); assert.equal(f.pauses(), 1);
  f.frame(0); f.frame(0); assert.equal(f.camera.current(f.stream, 6001), undefined);
  assert.deepEqual(f.issues, ['camera-unavailable']);
  f.clock(6010); f.frame(.1); assert.equal(f.camera.current(f.stream, 6010), f.video);
  assert.deepEqual(f.issues, ['camera-unavailable', 'camera-restored']);
});
test('continuous missing frames refresh only the same consumer twice and never reopen the source', t => {
  const f = fixture(t); f.camera.current(f.stream, 0);
  for (const now of [6000, 11000, 16000, 21000]) {
    f.clock(now); f.camera.current(f.stream, now); f.frame(0); f.frame(0);
  }
  assert.equal(f.plays(), 3); assert.equal(f.pauses(), 2);
  assert.equal(f.video.srcObject, f.stream); assert.equal(f.track.readyState, 'live');
  assert.deepEqual(f.issues, ['camera-unavailable']);
});
test('ended or muted camera tracks are removed without retrying them and an intentional close clears only their warning', t => {
  const f = fixture(t); f.camera.current(f.stream, 0); f.frame(0); f.frame(.1);
  f.track.muted = true; assert.equal(f.camera.current(f.stream, 1), undefined);
  f.track.muted = false; f.track.readyState = 'ended'; assert.equal(f.camera.current(f.stream, 2), undefined);
  assert.equal(f.plays(), 1); assert.equal(f.pauses(), 0);
  f.camera.current(null, 3); assert.deepEqual(f.issues, ['camera-unavailable', 'camera-restored']);
});
test('a rejected play promise from a replaced source cannot poison the current camera', async t => {
  const f = fixture(t); let reject!: (reason: Error) => void;
  f.video.play = () => new Promise<void>((_resolve, no) => { reject = no; });
  f.camera.current(f.stream, 0);
  f.video.play = () => Promise.resolve();
  const next = { getVideoTracks: () => [f.track] } as unknown as MediaStream;
  f.camera.current(next, 1); reject(new Error('Old play failed')); await Promise.resolve();
  f.frame(0); f.frame(.1); assert.equal(f.camera.current(next, 2), f.video);
  assert.deepEqual(f.issues, []);
});
