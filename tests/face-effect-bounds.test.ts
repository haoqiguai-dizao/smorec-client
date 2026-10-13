import assert from 'node:assert/strict';
import test from 'node:test';
import { faceEffectBounds } from '../src/services/camera-effects/face/bounds';
import { applyFaceEffects } from '../src/services/camera-effects/face/kernel';
import type { FaceGeometry } from '../src/services/camera-effects/face/geometry';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';

test('conservative bounds include rotated faces, shifted warp support and every anatomical polygon', () => {
  const face: FaceGeometry = { aspect: 2, center: { x: 1, y: .5 }, axis: { x: Math.SQRT1_2, y: Math.SQRT1_2 },
    width: .3, height: .5, mouthOpen: .7, mouth: [{ x: 1.2, y: .7 }], eyes: [[{ x: .8, y: .3 }]],
    warps: [{ center: { x: .5, y: .5 }, dx: -.1, dy: .04, radius: .15, zoom: .1 }] };
  const [left, top, right, bottom] = faceEffectBounds(face);
  for (let i = 0; i < 360; i++) {
    const theta = i * Math.PI / 180, x = Math.cos(theta) * face.width * .52, y = Math.sin(theta) * face.height * .52;
    const px = face.center.x + x * face.axis.x - y * face.axis.y, py = face.center.y + x * face.axis.y + y * face.axis.x;
    assert.ok(px >= left && px <= right && py >= top && py <= bottom);
  }
  assert.ok(left < .25 && top < .39 && right > 1.2 && bottom > .7);
});

test('full CPU reference leaves every pixel outside the shader bounds unchanged', () => {
  const width = 96, height = 64;
  const source = { width, height, data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : i * 17 % 256) } as ImageData;
  const target = { width, height, data: new Uint8ClampedArray(source.data.length) } as ImageData;
  const oval = (cx: number, cy: number, count: number) => Array.from({ length: count }, (_, i) => ({
    x: cx + Math.cos(i * Math.PI * 2 / count) * .035, y: cy + Math.sin(i * Math.PI * 2 / count) * .015,
  }));
  const face: FaceGeometry = { aspect: 1.5, center: { x: .7, y: .5 }, axis: { x: .8, y: .6 }, width: .3, height: .4,
    warps: [{ center: { x: .8, y: .5 }, radius: .12, dx: -.02, dy: .01, zoom: .1 }],
    mouth: oval(.7, .59, 20), eyes: [oval(.64, .45, 8), oval(.77, .46, 8)], mouthOpen: .8 };
  applyFaceEffects(source, target, { ...DEFAULT_CAMERA_EFFECTS, skinWhitening: 1, rosiness: 1, eyeBrightening: 1, teethWhitening: 1 }, face);
  const [left, top, right, bottom] = faceEffectBounds(face);
  let checked = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = (x + .5) / height, py = (y + .5) / height;
    if (px >= left && px <= right && py >= top && py <= bottom) continue;
    const offset = (y * width + x) * 4;
    assert.deepEqual(target.data.subarray(offset, offset + 4), source.data.subarray(offset, offset + 4)); checked++;
  }
  assert.ok(checked > width * height / 2);
});
