import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import type { CameraEffects } from '../shared/types';
import { applyCameraEffects } from '../src/services/camera-effects/kernel';

const isolated: CameraEffects = { ...DEFAULT_CAMERA_EFFECTS, smoothing: 0, brightness: 0, intensity: 0 };
const strengths = [0, 0.25, 0.67, 1];

function frame(width = 480, height = 64): ImageData {
  return { width, height, colorSpace: 'srgb', data: new Uint8ClampedArray(width * height * 4) };
}

function process(input: ImageData, effects: Partial<CameraEffects>): ImageData {
  const output = frame(input.width, input.height);
  applyCameraEffects(input, output, { ...isolated, ...effects });
  return output;
}

function skinNoise(color: readonly number[]): ImageData {
  const image = frame();
  let random = 271828;
  for (let index = 0; index < image.data.length; index += 4) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const noise = (random % 25) - 12;
    for (let channel = 0; channel < 3; channel++) image.data[index + channel] = color[channel] + noise;
    image.data[index + 3] = 255;
  }
  return image;
}

function variance(image: ImageData): number {
  let sum = 0, squares = 0, count = 0;
  for (let y = 2; y < image.height - 2; y++) for (let x = 2; x < image.width - 2; x++) {
    const index = (y * image.width + x) * 4;
    const luma = 0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2];
    sum += luma; squares += luma * luma; count++;
  }
  return squares / count - (sum / count) ** 2;
}

function meanRgbDifference(left: ImageData, right: ImageData): number {
  let sum = 0;
  for (let index = 0; index < left.data.length; index++) {
    if (index % 4 !== 3) sum += Math.abs(left.data[index] - right.data[index]);
  }
  return sum / (left.width * left.height * 3);
}

test('zero strength is byte-identical for every filter including translucent input', () => {
  const input = skinNoise([191, 139, 108]);
  for (let index = 3; index < input.data.length; index += 4) input.data[index] = (index * 17) % 256;
  const original = input.data.slice();
  for (const filter of ['natural', 'warm', 'cool', 'mono'] as const) {
    assert.deepEqual(process(input, { filter }).data, original);
  }
  assert.deepEqual(input.data, original);
});

test('skin-noise variance falls visibly and monotonically across the strength range', context => {
  for (const [name, color] of [
    ['light', [206, 161, 137]], ['medium', [176, 122, 92]], ['deep', [82, 55, 42]],
    ['low-light', [40, 28, 24]], ['cool-light', [151, 128, 143]],
  ] as const) {
    const input = skinNoise(color);
    const original = input.data.slice();
    const baseline = variance(input);
    const ratios = strengths.map((smoothing) => variance(process(input, { smoothing })) / baseline);
    context.diagnostic(`${name} noise variance ratios at 0/25/67/100%: ${ratios.map((value) => value.toFixed(4)).join(', ')}`);
    assert.equal(ratios[0], 1);
    for (let index = 1; index < ratios.length; index++) assert.ok(ratios[index] < ratios[index - 1] - 0.08,
      `${name} must have a meaningful noise reduction at each strength step: ${ratios}`);
    assert.ok(ratios[1] < 0.8, `${name} at 25% must reduce variance by at least 20%`);
    assert.ok(ratios[2] < 0.5, `${name} at 67% must reduce variance by at least 50%`);
    assert.ok(ratios[3] < 0.35, `${name} at 100% must reduce variance by at least 65%`);
    assert.deepEqual(input.data, original, 'The raw source is never modified');
  }
});

test('strong smoothing preserves skin hard edges, black eye-lines and alpha exactly', () => {
  const input = frame(480, 64);
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) {
    const index = (y * input.width + x) * 4;
    const color = x < 240 ? [191, 139, 108] : [82, 55, 42];
    input.data.set(x === 120 ? [0, 0, 0, 255] : [...color, 255], index);
  }
  const output = process(input, { smoothing: 1 });
  assert.deepEqual(output.data, input.data, 'Cross-edge samples must not contaminate either side or the one-pixel feature');
  const left = (32 * input.width + 239) * 4;
  const right = left + 4;
  assert.equal(output.data[left] - output.data[right], 109, 'Skin edge contrast must remain unchanged');
});

test('skin smoothing leaves saturated non-skin and neutral texture unchanged', () => {
  for (const color of [[24, 180, 48], [20, 65, 220], [100, 100, 100]]) {
    const input = skinNoise(color);
    assert.deepEqual(process(input, { smoothing: 1 }).data, input.data);
  }
});

test('brightness lifts low-light and midtones without lifting black or clipping highlights', context => {
  const input = frame(256, 1);
  for (let value = 0; value < 256; value++) input.data.set([value, value, value, 255], value * 4);
  const outputs = strengths.map((brightness) => process(input, { brightness }));
  const values = [32, 128, 240].map((value) => ({ input: value, output: outputs.map((image) => image.data[value * 4]) }));
  context.diagnostic(`Low/mid/highlight tone response: ${JSON.stringify(values)}`);
  for (const output of outputs) {
    assert.equal(output.data[0], 0);
    assert.equal(output.data[255 * 4], 255);
    for (let value = 1; value < 256; value++) assert.ok(output.data[value * 4] >= output.data[(value - 1) * 4]);
    for (let value = 1; value < 252; value++) assert.ok(output.data[value * 4] > 0 && output.data[value * 4] < 255);
    const clipped = Array.from({ length: 256 }, (_, value) => output.data[value * 4]).filter((value) => value === 255).length;
    assert.ok(clipped / 256 <= 0.01, `Highlight clip rate ${clipped / 256} exceeds 1% including input white`);
  }
  for (const { output } of values) {
    for (let index = 1; index < output.length; index++) assert.ok(output[index] > output[index - 1]);
  }
  const ordinary = process(input, { brightness: 0.18 });
  assert.ok(ordinary.data[32 * 4] - 32 >= 4, 'The existing 18% brightness setting must visibly lift low light');
  assert.ok(ordinary.data[128 * 4] - 128 >= 10, 'The existing 18% brightness setting must visibly lift midtones');
});

test('filter strength has a measurable monotonic effect without recoloring pure black or white', context => {
  const colors = [[191, 139, 108], [82, 55, 42], [151, 128, 143], [65, 100, 150], [95, 170, 115], [128, 128, 128]];
  const input = frame(colors.length, 1);
  colors.forEach((color, index) => input.data.set([...color, 255], index * 4));
  for (const filter of ['natural', 'warm', 'cool', 'mono'] as const) {
    const differences = strengths.map((intensity) => meanRgbDifference(input, process(input, { filter, intensity })));
    context.diagnostic(`${filter} mean RGB change at 0/25/67/100%: ${differences.map((value) => value.toFixed(3)).join(', ')}`);
    assert.equal(differences[0], 0);
    assert.ok(differences[1] >= 2, `${filter} at 25% must not be a merely one-code-value change`);
    assert.ok(differences[3] >= 8, `${filter} at 100% must provide a visible adjustment range`);
    for (let index = 1; index < differences.length; index++) assert.ok(differences[index] > differences[index - 1]);
    const endpoints = frame(2, 1);
    endpoints.data.set([0, 0, 0, 255, 255, 255, 255, 255]);
    assert.deepEqual(process(endpoints, { filter, intensity: 1 }).data, endpoints.data);
  }
});
