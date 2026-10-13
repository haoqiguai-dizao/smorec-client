import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { FacePreparation } from '../src/services/camera-effects/face/preparation';
import type { FaceTracker } from '../src/services/camera-effects/face/tracker';
import { markMediaFrame } from '../src/services/media-frame-identity';

const token = {};
const frame = (time: number) => {
  const result = { time } as unknown as CanvasImageSource;
  markMediaFrame(result, token, time); return result;
};

test('pending duplicates share inference while distinct frames use one ordered model', async () => {
  const calls: number[] = []; let release!: () => void, created = 0;
  const held = new Promise<void>(resolve => { release = resolve; });
  const preparation = new FacePreparation(() => {
    created++;
    return { async detect(source: unknown) {
      const time = (source as { time: number }).time; calls.push(time);
      if (time === 1) await held;
      return [{ x: time, y: 0 }];
    }, dispose() {} } as unknown as FaceTracker;
  });
  try {
    const first = frame(1), duplicate = frame(1), second = frame(2);
    const a = preparation.prepare(first), b = preparation.prepare(duplicate), c = preparation.prepare(second);
    assert.equal(a, b); await setImmediate();
    assert.deepEqual(calls, [1]); assert.equal(created, 1); assert.equal(preparation.points(second), undefined);
    release(); await Promise.all([a, b, c]);
    assert.deepEqual(calls, [1, 2]);
    assert.deepEqual(preparation.points(first), [{ x: 1, y: 0 }]);
    assert.deepEqual(preparation.points(second), [{ x: 2, y: 0 }]);
  } finally { preparation.dispose(); }
});

test('dispose rejects active inference and queued work without starting another detection', async () => {
  let reject!: (error: Error) => void, detected = 0, disposed = 0;
  const preparation = new FacePreparation(() => ({
    detect() { detected++; return new Promise((_, fail) => { reject = fail; }); },
    dispose() { disposed++; reject(new Error('disposed')); },
  }) as unknown as FaceTracker);
  const first = preparation.prepare(frame(1)), second = preparation.prepare(frame(2));
  const failures = [assert.rejects(first, /disposed/), assert.rejects(second, /已释放/)];
  await setImmediate(); preparation.dispose(); await Promise.all(failures);
  assert.equal(detected, 1); assert.equal(disposed, 1);
  assert.equal(preparation.points(frame(1)), undefined);
});

test('out-of-order decoding and repeated frames retain the unconsumed output window', async () => {
  const preparation = new FacePreparation(() => ({
    async detect(source: unknown) { return [{ x: (source as { time: number }).time, y: 0 }]; }, dispose() {},
  }) as unknown as FaceTracker);
  try {
    // A hidden screen lets output 1 decode before output 0. Both are still needed.
    await Promise.all([1, 0, 2, 3].map(index => preparation.prepare(frame(index), index)));
    assert.deepEqual(preparation.points(frame(0)), [{ x: 0, y: 0 }]);
    await preparation.prepare(frame(4), 4);
    assert.deepEqual(preparation.points(frame(1)), [{ x: 1, y: 0 }], 'Advance drops output 0, not the first arrival');
    assert.equal(preparation.points(frame(0)), undefined);
    // A cut can request an already prepared source again in a later output slot.
    await preparation.prepare(frame(1), 5);
    await preparation.prepare(frame(6), 6);
    assert.deepEqual(preparation.points(frame(1)), [{ x: 1, y: 0 }], 'Reuse extends retention through its latest output slot');
    assert.equal(preparation.points(frame(2)), undefined);
  } finally { preparation.dispose(); }
});
