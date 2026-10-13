import assert from 'node:assert/strict';
import test from 'node:test';
import { presenterSourceRect } from '../shared/presenter';
import { cameraResizeContour } from '../src/services/camera-resize-contour';
import { CAMERA_SHAPES, cameraShapeGeometry } from '../shared/camera-shapes';

test('presenter portrait crop covers output without stretching and remains inside source at all alignments and zooms', () => {
  for (const [sw, sh] of [[1920, 1080], [1080, 1920], [1440, 1080]]) {
    for (const zoom of [1, 1.3, 3]) for (const x of [0, .2, .5, 1]) for (const y of [0, .7, 1]) {
      const rect = presenterSourceRect(sw, sh, 1080, 1920, { x, y }, zoom);
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= sw + 1e-8 && rect.y + rect.height <= sh + 1e-8);
      assert.ok(Math.abs(rect.width / rect.height - 9 / 16) < 1e-8);
      assert.equal(rect.x, (sw - rect.width) * x); assert.equal(rect.y, (sh - rect.height) * y);
    }
  }
});
test('resize hot zones form a continuous ring on actual shape boundaries, not the outer square corners', () => {
  for (const shape of CAMERA_SHAPES) {
    const { width, height, radius } = cameraShapeGeometry(shape, 100);
    const { segments } = cameraResizeContour(shape);
    for (let i = 0; i < segments.length; i++) {
      const point = segments[i].point;
      assert.ok(point.x >= -1e-8 && point.y >= -1e-8 && point.x <= width + 1e-8 && point.y <= height + 1e-8);
      const x = Math.max(0, Math.abs(point.x - width / 2) - (width / 2 - radius));
      const y = Math.max(0, Math.abs(point.y - height / 2) - (height / 2 - radius));
      assert.ok(Math.abs(Math.hypot(x, y) - radius) < 1e-7);
      assert.equal(segments[i].path.split(' ').at(-1)!.slice(1), segments[(i + 1) % 8].path.split(' ')[0].slice(1));
    }
    const nw = segments.find(segment => segment.edge === 'nw')!.point;
    assert.ok(nw.x > 0 || nw.y > 0, 'A rounded shape never uses the rectangular corner');
  }
});
