import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMERA_BEAUTY_PRESETS, cameraBeautyPreset, DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import { applyCameraEffects } from '../src/services/camera-effects/kernel';
import { SkinSmoothing } from '../src/services/camera-effects/skin-smoothing';

function patch(width = 480, height = 80): ImageData {
  return { width, height, colorSpace: 'srgb', data: new Uint8ClampedArray(width * height * 4) };
}
const isolated = { ...DEFAULT_CAMERA_EFFECTS, smoothing: 1, brightness: 0, intensity: 0 };

test('multi-pixel skin blemishes are softened, beyond single-pixel sensor noise', context => {
  const input = patch(), output = patch();
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    const spot = 24 * Math.exp(-((x - 240) ** 2 + (y - 40) ** 2) / 4);
    input.data.set([191 - spot, 139 - spot, 108 - spot, 255], (y * input.width + x) * 4);
  }
  applyCameraEffects(input, output, isolated);
  const center = (40 * input.width + 240) * 4;
  const reduction = output.data[center] - input.data[center];
  context.diagnostic('24-code-value skin blemish center lifted by ' + reduction);
  assert.ok(reduction >= 4, 'A spatial blemish must visibly soften, not just isolated noise');
  assert.ok(output.data[center] < 191, 'Keep some skin character instead of painting the spot flat');
  assert.equal(output.data[(40 * input.width + 220) * 4], 191, 'Do not create a surrounding halo');
});

test('the high-frequency detail layer preserves texture without overshoot', () => {
  const input = patch();
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    const detail = (x + y) % 2 === 0 ? 10 : -10;
    input.data.set([191 + detail, 139 + detail, 108 + detail, 255], (y * input.width + x) * 4);
  }
  const smoothing = new SkinSmoothing(input);
  smoothing.process(240, 40, 201 / 255, 149 / 255, 118 / 255);
  assert.ok(smoothing.tone[0] * 255 > 192, 'Restore luminance texture above the neighborhood average');
  assert.ok(smoothing.tone[0] * 255 <= 201, 'Detail restoration must not sharpen past the source');
  const output = patch(); applyCameraEffects(input, output, isolated);
  const high = output.data[(40 * input.width + 240) * 4], low = output.data[(40 * input.width + 241) * 4];
  assert.ok(high - low >= 5, 'Even maximum smoothing must retain a visible texture signal');
  assert.ok(high - low < 20, 'Fine-grained noise should still be reduced');
});

test('smoothing preserves large-scale facial shading and uniform color', () => {
  const input = patch(), output = patch();
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    const shade = Math.round(10 * Math.sin(x * Math.PI / input.width));
    input.data.set([180 + shade, 130 + shade, 100 + shade, 255], (y * input.width + x) * 4);
  }
  applyCameraEffects(input, output, isolated);
  for (let i = 0; i < input.data.length; i++) assert.ok(Math.abs(input.data[i] - output.data[i]) <= 1);
});

test('presets remain serializable ordinary settings and manual edits leave preset selection', () => {
  for (const preset of CAMERA_BEAUTY_PRESETS) {
    assert.equal(cameraBeautyPreset(JSON.parse(JSON.stringify(preset.effects))), preset.id);
    assert.equal(cameraBeautyPreset({ ...preset.effects, smoothing: 0.23 }), undefined);
    assert.equal(cameraBeautyPreset({ ...preset.effects, enabled: false }), undefined);
    for (const value of [preset.effects.smoothing, preset.effects.brightness, preset.effects.intensity]) assert.ok(value >= 0 && value <= 1);
  }
  assert.equal(cameraBeautyPreset(DEFAULT_CAMERA_EFFECTS), 'natural');
});
