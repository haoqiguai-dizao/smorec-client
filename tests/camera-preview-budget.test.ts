import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraPreviewNextPaint, cameraPreviewSize } from '../src/services/camera-effects/preview-budget';
import { cameraPreviewEncoding } from '../shared/camera-preview';

test('small preview processes only its physical cover pixels while retaining source aspect', () => {
  assert.deepEqual(cameraPreviewSize({ width: 1920, height: 1080 }, { width: 256, height: 256 }, 1.5), { width: 683, height: 384 });
  assert.deepEqual(cameraPreviewSize({ width: 1920, height: 1080 }, { width: 960, height: 540 }, 1.5), { width: 1440, height: 810 });
  assert.deepEqual(cameraPreviewSize({ width: 1920, height: 1080 }, { width: 960, height: 540 }, 2), { width: 1920, height: 1080 });
});

test('portrait cameras and zoomed displays never stretch or upscale source detail', () => {
  assert.deepEqual(cameraPreviewSize({ width: 1080, height: 1920 }, { width: 240, height: 240 }, 1), { width: 240, height: 427 });
  assert.deepEqual(cameraPreviewSize({ width: 640, height: 360 }, { width: 960, height: 540 }, 2), { width: 640, height: 360 });
});

test('unlaid-out or hidden preview has no pixel allocation budget', () => {
  for (const width of [0, -1, NaN, Infinity]) {
    assert.equal(cameraPreviewSize({ width: 1920, height: 1080 }, { width, height: 256 }, 1), null);
  }
});

test('preview cadence caps fast GPU frames at 30fps and leaves CPU fallback recovery time', () => {
  for (const backend of ['gpu', 'bypass'] as const) {
    assert.equal(cameraPreviewNextPaint(100, 104, backend), 100 + 1000 / 30);
    assert.equal(cameraPreviewNextPaint(100, 150, backend), 150);
  }
  assert.equal(cameraPreviewNextPaint(100, 180, 'cpu'), 260);
  assert.equal(cameraPreviewNextPaint(100, 104, 'cpu'), 100 + 1000 / 15);
});

test('RTC cover scaling keeps both H264 dimensions even across camera aspects and window sizes', () => {
  for (const [width, height] of [[1920, 1080], [3840, 2160], [1080, 1920], [1280, 720], [640, 480]]) {
    for (const size of [129, 256, 259, 337, 519, 720, 961]) {
      const viewport = { width: size, height: size, density: 1, visible: true, revision: 1 };
      const value = cameraPreviewEncoding({ width, height }, viewport);
      const w = Math.floor(width / value.scaleResolutionDownBy), h = Math.floor(height / value.scaleResolutionDownBy);
      assert.equal(w % 2, 0, `${width}×${height} at ${size}: width ${w}`);
      assert.equal(h % 2, 0, `${width}×${height} at ${size}: height ${h}`);
      assert.ok(w > 0 && h > 0 && w <= width && h <= height, 'Never upscale source detail');
      assert.ok(Math.max(w, h) <= 1280 && w * h <= 1280 * 720, 'Keep preview inside its pixel budget');
      assert.equal(w / h, width / height, 'Preserve the camera aspect ratio');
    }
  }
  const value = cameraPreviewEncoding({ width: 1920, height: 1080 },
    { width: 519, height: 519, density: 1, visible: true, revision: 1 });
  assert.deepEqual([Math.floor(1920 / value.scaleResolutionDownBy), Math.floor(1080 / value.scaleResolutionDownBy)], [928, 522]);
});
