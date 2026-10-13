import assert from 'node:assert/strict';
import test from 'node:test';
import type { Rectangle } from 'electron';
import { cameraSettingsGeometry } from '../electron/services/recording-overlay/camera-settings-geometry';
import { cameraOverlayBounds, presenterCameraBounds } from '../electron/services/recording-overlay/geometry';

function inside(rectangle: Rectangle, area: Rectangle) {
  return rectangle.x >= area.x && rectangle.y >= area.y && rectangle.x + rectangle.width <= area.x + area.width
    && rectangle.y + rectangle.height <= area.y + area.height;
}
function overlap(a: Rectangle, b: Rectangle) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('camera settings fit beside every small-window shape at work-area edges without changing the camera rectangle', () => {
  const area = { x: -1920, y: -80, width: 1920, height: 1040 };
  const sides = new Set<string>();
  for (const shape of ['circle', 'rounded', 'square', 'landscape', 'portrait', 'capsule'] as const) {
    for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) {
      const camera = cameraOverlayBounds(area, .42, { x, y }, shape);
      const before = { ...camera }, result = cameraSettingsGeometry(camera, area);
      assert.deepEqual(camera, before);
      assert.ok(inside(result.bounds, area), JSON.stringify({ shape, x, y, result }));
      assert.ok(inside(camera, result.bounds)); assert.ok(inside(result.settings, result.bounds));
      assert.equal(overlap(camera, result.settings), false);
      sides.add(result.side);
    }
  }
  assert.ok(sides.has('left') && sides.has('right'));
});

test('presenter controls use adjacent work-area space and scroll instead of resizing the 16:9 image', () => {
  for (const area of [{ x: 0, y: 0, width: 1280, height: 720 }, { x: -1536, y: 0, width: 1536, height: 832 },
    { x: 2560, y: -120, width: 1920, height: 1040 }]) {
    for (const center of [{ x: .5, y: .5 }, { x: 0, y: 0 }, { x: 1, y: 1 }]) {
      const camera = presenterCameraBounds(area, center), result = cameraSettingsGeometry(camera, area);
      assert.ok(inside(result.bounds, area)); assert.equal(overlap(camera, result.settings), false);
      assert.equal((camera.width - 12) / (camera.height - 12), 16 / 9);
    }
  }
});

test('above/below placement works when neither horizontal side has room, while impossible space is explicit', () => {
  const area = { x: 0, y: 0, width: 500, height: 1000 };
  for (const [y, side] of [[0, 'bottom'], [700, 'top']] as const) {
    const result = cameraSettingsGeometry({ x: 60, y, width: 380, height: 300 }, area);
    assert.equal(result.side, side); assert.ok(inside(result.bounds, area));
  }
  assert.throws(() => cameraSettingsGeometry({ x: 0, y: 0, width: 200, height: 100 },
    { x: 0, y: 0, width: 200, height: 100 }), /空间不足/);
});
