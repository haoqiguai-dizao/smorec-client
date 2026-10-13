import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLE } from '../shared/constants';
import { getExportCanvasSize, getExportFrameBatchSize, getPreviewCanvasSize, isSupportedExportSize,
  MAX_EXPORT_PIXELS, MAX_PREVIEW_PIXELS } from '../shared/canvas';
import type { Project } from '../shared/types';

const source = (width: number, height: number, aspect: Project['style']['aspect'] = '16:9') =>
  ({ width, height, style: { ...DEFAULT_STYLE, aspect } });

test('original resolution and selected aspect determine export without enlarging small media', () => {
  for (const [width, height, landscape, portrait, square] of [
    [3840, 2160, [3840, 2160], [2160, 3840], [2160, 2160]],
    [2160, 3840, [3840, 2160], [2160, 3840], [2160, 2160]],
    [1920, 1080, [1920, 1080], [1080, 1920], [1080, 1080]],
    [1440, 1080, [1440, 810], [810, 1440], [1080, 1080]],
    [640, 480, [640, 360], [360, 640], [480, 480]],
    [2560, 1080, [1920, 1080], [1080, 1920], [1080, 1080]],
  ] as const) {
    for (const [aspect, expected] of [['16:9', landscape], ['9:16', portrait], ['1:1', square]] as const) {
      const project = source(width, height, aspect), before = structuredClone(project);
      assert.deepEqual(Object.values(getExportCanvasSize(project)), expected);
      assert.deepEqual(project, before, 'Sizing must not rewrite saved projects or style preferences');
    }
    assert.deepEqual(getExportCanvasSize(source(width, height, 'auto')), { width, height });
  }
  assert.deepEqual(getExportCanvasSize(source(1921, 1081, 'auto')), { width: 1920, height: 1080 });
  assert.throws(() => getExportCanvasSize(source(Infinity, 2160)), /尺寸无效/);
});

test('preview follows container and DPR with an independent budget, preserving the export dimensions', () => {
  const project = source(3840, 2160), output = getExportCanvasSize(project);
  for (const [density, width, height] of [[1, 960, 540], [1.5, 1440, 810], [2, 1920, 1080], [4, 2560, 1440]]) {
    assert.deepEqual(getPreviewCanvasSize(output, { width: 960, height: 540, density }), { width, height });
  }
  assert.deepEqual(getPreviewCanvasSize(output, { width: 4000, height: 3000, density: 2 }), { width: 2560, height: 1440 });
  assert.deepEqual(getExportCanvasSize(project), { width: 3840, height: 2160 });
  assert.deepEqual(getPreviewCanvasSize({ width: 640, height: 360 }, { width: 960, height: 540, density: 2 }), { width: 640, height: 360 });
  const square = getPreviewCanvasSize({ width: 2160, height: 2160 }, { width: 2160, height: 2160, density: 2 });
  assert.deepEqual(square, { width: 1920, height: 1920 });
  assert.ok(square!.width * square!.height <= MAX_PREVIEW_PIXELS);
  assert.equal(getPreviewCanvasSize(output, { width: 0, height: 0, density: 1 }), null);
  assert.equal(getPreviewCanvasSize(output, { width: NaN, height: 500, density: 1 }), null);
  assert.deepEqual(getPreviewCanvasSize(output, { width: 960, height: 540, density: NaN }), { width: 960, height: 540 });
});

test('export rejects oversized or malformed rasters rather than silently reducing resolution', () => {
  assert.equal(isSupportedExportSize({ width: 7680, height: 4320 }), true);
  assert.equal(isSupportedExportSize({ width: 8192, height: 4000 }), true);
  assert.equal(isSupportedExportSize({ width: 8192, height: 8192 }), false);
  assert.equal(isSupportedExportSize({ width: 8200, height: 100 }), false);
  for (const width of [0, 1, 1919, 1920.5, NaN, Infinity]) {
    assert.equal(isSupportedExportSize({ width, height: 1080 }), false);
  }
  const large = getExportCanvasSize(source(10000, 6000, 'auto'));
  assert.deepEqual(large, { width: 10000, height: 6000 });
  assert.ok(large.width * large.height > MAX_EXPORT_PIXELS);
});

test('larger exports reduce queued frame count to bound pixel memory', () => {
  for (const [width, height, expected] of [[640, 360, 8], [1920, 1080, 8], [2560, 1440, 4], [3840, 2160, 2], [7680, 4320, 1]]) {
    assert.equal(getExportFrameBatchSize({ width, height }), expected);
  }
});
