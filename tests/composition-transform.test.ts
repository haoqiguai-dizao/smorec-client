import assert from 'node:assert/strict';
import test from 'node:test';
import { transformCompositionCamera, type CompositionTransformStart } from '../src/services/composition-transform';

const base: CompositionTransformStart = { mode: 'move', rect: { x: 400, y: 200, width: 200, height: 200 },
  output: { width: 1280, height: 720 }, viewport: { width: 640, height: 360 }, clientX: 300, clientY: 200 };
test('composition move uses output-normalized top-left and clamps custom positions inside the canvas', () => {
  assert.deepEqual(transformCompositionCamera(base, 350, 225), { x: 500 / 1280, y: 250 / 720 });
  assert.deepEqual(transformCompositionCamera(base, -9999, -9999), { x: 0, y: 0 });
  assert.deepEqual(transformCompositionCamera(base, 9999, 9999), { x: 1080 / 1280, y: 520 / 720 });
});
test('composition corners preserve aspect ratio and the opposite anchor across different preview scales', () => {
  for (const viewportScale of [.25, .5, 1, 1.5]) {
    for (const mode of ['nw', 'ne', 'se', 'sw'] as const) {
      const start = { ...base, mode, viewport: { width: 1280 * viewportScale, height: 720 * viewportScale } };
      const left = mode.includes('w'), top = mode.includes('n');
      const result = transformCompositionCamera(start, 300 + (left ? -50 : 50) * viewportScale, 200 + (top ? -50 : 50) * viewportScale);
      assert.equal(result.size, 250 / 720);
      assert.equal(result.x, (left ? 350 : 400) / 1280); assert.equal(result.y, (top ? 150 : 200) / 720);
    }
  }
});
test('composition portrait resizing cannot exceed the frame or stretch the person', () => {
  const start = { ...base, mode: 'se' as const, rect: { x: 900, y: 100, width: 150, height: 200 } };
  const result = transformCompositionCamera(start, 9999, 9999);
  const width = result.size! * 720, height = width / .75;
  assert.ok(result.x! * 1280 + width <= 1280 + .00001);
  assert.ok(result.y! * 720 + height <= 720 + .00001);
  const minimum = transformCompositionCamera(start, -9999, -9999);
  assert.equal(minimum.size, .08);
});
