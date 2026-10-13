import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CAMERA_EFFECTS, ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';
import { sourceSize } from '../src/services/camera-effects/canvas';
import { applyCameraEffects } from '../src/services/camera-effects/kernel';
import { cameraPreviewCooldown } from '../src/services/camera-effects/preview-budget';
import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';

function frame(width: number, height: number): ImageData {
  return { width, height, colorSpace: 'srgb', data: new Uint8ClampedArray(width * height * 4) };
}

function fill(data: ImageData, red: number, green: number, blue: number, alpha = 255): void {
  for (let index = 0; index < data.data.length; index += 4) {
    data.data[index] = red; data.data[index + 1] = green;
    data.data[index + 2] = blue; data.data[index + 3] = alpha;
  }
}

function checkerboard(): ImageData {
  const image = frame(1920, 1080);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const offset = (y * image.width + x) * 4;
    const high = (x + y) % 2 === 1;
    image.data[offset] = x < 960 ? high ? 255 : 0 : high ? 28 : 16;
    image.data[offset + 1] = x < 960 ? high ? 255 : 0 : high ? 208 : 64;
    image.data[offset + 2] = x < 960 ? high ? 255 : 0 : high ? 64 : 224;
    image.data[offset + 3] = 255;
  }
  return image;
}

test('camera effects preserve intrinsic 1080p/4K display pixels independently of CSS and DPR', () => {
  for (const [source, expected] of [
    [{ videoWidth: 1920, videoHeight: 1080, width: 320, height: 180, devicePixelRatio: 3 }, { width: 1920, height: 1080 }],
    [{ displayWidth: 1920, displayHeight: 1080, codedWidth: 2048, codedHeight: 1088 }, { width: 1920, height: 1080 }],
    [{ naturalWidth: 3840, naturalHeight: 2160, width: 640, height: 360 }, { width: 3840, height: 2160 }],
    [{ width: 1920, height: 1080, clientWidth: 400, clientHeight: 225 }, { width: 1920, height: 1080 }],
    [{ width: 320, height: 180, devicePixelRatio: 3 }, { width: 320, height: 180 }],
  ] as const) assert.deepEqual(sourceSize(source as unknown as CanvasImageSource), expected);
  for (const width of [0, -1, NaN, Infinity]) {
    assert.throws(() => sourceSize({ videoWidth: width, videoHeight: 1080 } as HTMLVideoElement));
  }
});

test('disabled and zero-strength effects return the original source without requesting a canvas or GPU', () => {
  const source = { width: 1920, height: 1080 } as HTMLCanvasElement;
  const renderer = new CameraEffectsRenderer();
  assert.equal(renderer.render(source, ORIGINAL_CAMERA_EFFECTS), source);
  assert.equal(renderer.render(source, { ...DEFAULT_CAMERA_EFFECTS, smoothing: 0, brightness: 0, intensity: 0 }), source);
  assert.equal(renderer.backend, 'bypass');
  renderer.dispose();
  assert.throws(() => renderer.render(source, DEFAULT_CAMERA_EFFECTS), /已释放/);
});

test('1080p one-pixel neutral and non-skin detail survives smoothing byte for byte', context => {
  const input = checkerboard(), output = frame(input.width, input.height);
  const original = input.data.slice();
  const started = performance.now();
  applyCameraEffects(input, output, { ...DEFAULT_CAMERA_EFFECTS, smoothing: 1, brightness: 0, intensity: 0 });
  context.diagnostic(`1080p full-resolution CPU detail frame: ${(performance.now() - started).toFixed(1)} ms`);
  assert.deepEqual(output.data, original, 'A one-pixel checkerboard must not become a downsampled gray field');
  assert.deepEqual(input.data, original, 'Processing must not modify raw camera pixels');
  assert.equal(output.width, 1920); assert.equal(output.height, 1080);
});

test('default effects preserve 1080p one-pixel contrast and refresh reused output buffers', () => {
  const input = checkerboard(), output = frame(input.width, input.height);
  applyCameraEffects(input, output, DEFAULT_CAMERA_EFFECTS);
  let minimumContrast = 255;
  for (let y = 0; y < input.height; y++) for (let x = 0; x < 958; x += 2) {
    const offset = (y * input.width + x) * 4;
    minimumContrast = Math.min(minimumContrast, Math.abs(output.data[offset] - output.data[offset + 4]));
  }
  assert.ok(minimumContrast >= 240, `The 1px checkerboard contrast fell to ${minimumContrast}`);
  const dark = output.data[0], light = output.data[4];
  for (let y = 0; y < input.height; y++) for (let x = 0; x < 960; x++) {
    const offset = (y * input.width + x) * 4;
    for (let channel = 0; channel < 3; channel++) input.data[offset + channel] = 255 - input.data[offset + channel];
  }
  applyCameraEffects(input, output, DEFAULT_CAMERA_EFFECTS);
  assert.equal(output.data[0], light); assert.equal(output.data[4], dark);
});

test('full-resolution CPU smooths skin noise while preserving one-pixel dark features', context => {
  const input = frame(1920, 1080), output = frame(input.width, input.height);
  fill(input, 191, 139, 108);
  const noisy = (500 * input.width + 500) * 4;
  input.data.set([215, 155, 120, 255], noisy);
  for (let y = 0; y < input.height; y++) input.data.set([0, 0, 0, 255], (y * input.width + 1200) * 4);
  const started = performance.now();
  applyCameraEffects(input, output, { ...DEFAULT_CAMERA_EFFECTS, smoothing: 1, brightness: 0, intensity: 0 });
  context.diagnostic(`1080p full-skin CPU smoothing frame: ${(performance.now() - started).toFixed(1)} ms`);
  assert.ok(output.data[noisy] < 215 && output.data[noisy] > 191, 'A skin impulse should be reduced without flattening it');
  for (let y = 0; y < input.height; y++) {
    const offset = (y * input.width + 1200) * 4;
    assert.deepEqual(output.data.subarray(offset, offset + 4), new Uint8ClampedArray([0, 0, 0, 255]));
  }
});

test('integer and fractional sampling ignore transparent neighbors without losing alpha', () => {
  for (const width of [1920, 1280]) {
    const input = frame(width, 9), output = frame(width, 9);
    fill(input, 255, 0, 255, 0);
    const offset = (4 * width + Math.floor(width / 2)) * 4;
    input.data.set([191, 139, 108, 255], offset);
    applyCameraEffects(input, output, { ...DEFAULT_CAMERA_EFFECTS, smoothing: 1, brightness: 0, intensity: 0 });
    assert.deepEqual(output.data.subarray(offset, offset + 4), new Uint8ClampedArray([191, 139, 108, 255]));
    for (let index = 3; index < input.data.length; index += 4) assert.equal(output.data[index], input.data[index]);
  }
});

test('CPU preview leaves equal idle time after slow frames and never exceeds 15 fps', () => {
  for (const elapsed of [0, 2, 12, 30, 66, 120, 500]) {
    const idle = cameraPreviewCooldown('cpu', elapsed);
    assert.ok(idle >= elapsed, `${elapsed} ms of rendering must leave at least the same idle interval`);
    assert.ok(elapsed + idle >= 1000 / 15, 'Fast CPU rendering must still leave a bounded preview cadence');
  }
  for (const backend of ['gpu', 'bypass'] as const) {
    assert.equal(cameraPreviewCooldown(backend, 120), 0, `${backend} frames retain native camera cadence`);
  }
});
