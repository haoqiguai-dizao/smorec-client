import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBoardWindowOptions } from '../electron/services/whiteboard/window-options';

test('local transparency is bounded and independent of pinning and passthrough', () => {
  assert.deepEqual(parseBoardWindowOptions({ transparency: .55, transparent: true, pinned: false }),
    { transparency: .55, transparent: true, pinned: false });
  for (const transparency of [0, 1]) assert.equal(parseBoardWindowOptions({ transparency }).transparency, transparency);
  for (const transparency of [-.01, 1.01, NaN, Infinity, '50']) assert.throws(() => parseBoardWindowOptions({ transparency }));
  assert.throws(() => parseBoardWindowOptions({ opacity: .5 }));
});
