import test from 'node:test';
import assert from 'node:assert/strict';
import { physicalRegion, selectionRect, validRegion } from '../shared/region-selection';
test('reverse mouse drag produces a positive rectangle and maps 150 percent display scaling to physical pixels', () => {
  const rect = selectionRect({ x: 920, y: 540 }, { x: 120, y: 60 });
  assert.deepEqual(rect, { x: 120, y: 60, width: 800, height: 480 });
  assert.deepEqual(physicalRegion(rect, { width: 1280, height: 720 }, { width: 1920, height: 1080 }),
    { x: 180, y: 90, width: 1200, height: 720 });
});
test('display-local selection clips to the source and accepts Retina 2x dimensions without global-origin offsets', () => {
  assert.deepEqual(physicalRegion({ x: -5, y: 30, width: 1200, height: 1000 }, { width: 1000, height: 700 }, { width: 2000, height: 1400 }),
    { x: 0, y: 60, width: 2000, height: 1340 });
  assert.equal(validRegion({ x: 1900, y: 1300, width: 100, height: 100 }, 2000, 1400), true);
  for (const invalid of [{ x: 0, y: 0, width: 31, height: 100 }, { x: -1, y: 0, width: 100, height: 100 },
    { x: 1950, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: NaN, height: 100 },
    { x: 0, y: 0, width: 100, height: 100, untrusted: true }]) assert.equal(validRegion(invalid, 2000, 1400), false);
});
