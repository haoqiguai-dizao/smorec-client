import type { CameraEffects } from '../shared/types';
import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';

const strengths = [0, 0.25, 0.67, 1];
const skinColors = [[206, 161, 137], [176, 122, 92], [82, 55, 42], [40, 28, 24], [151, 128, 143]];
const isolated: CameraEffects = { enabled: true, smoothing: 0, brightness: 0, filter: 'natural', intensity: 0 };
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement('canvas');
  result.width = width; result.height = height;
  return result;
}

function fixture(width: number): HTMLCanvasElement {
  const source = canvas(width, 416), context = source.getContext('2d')!;
  const image = context.createImageData(width, source.height);
  let random = 271828;
  for (let y = 0; y < source.height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const noise = random % 25 - 12;
    let color: number[], alpha = 255;
    if (y < 240) {
      color = skinColors[Math.floor(y / 48)].map((value) => value + noise);
      if (x === 20) color = [0, 0, 0];
    } else if (y < 288) color = [1, 1, 1].map(() => x % 2 ? 255 : 0);
    else if (y < 320) color = [1, 1, 1].map(() => Math.round(x / (width - 1) * 255));
    else if (y < 368) {
      color = [191, 139, 108];
      alpha = Math.round(x / (width - 1) * 255);
    } else color = (x + y) % 2 ? [24, 180, 48] : [20, 65, 220];
    image.data.set([...color, alpha], index);
  }
  context.putImageData(image, 0, 0);
  return source;
}

function pixels(source: CanvasImageSource, width: number, height: number): ImageData {
  const result = canvas(width, height), context = result.getContext('2d')!;
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, width, height);
}

function compare(first: ImageData, second: ImageData) {
  let opaqueMaximum = 0, opaqueSum = 0, opaqueCount = 0;
  let compositeMaximum = 0, compositeSum = 0, alphaMaximum = 0;
  for (let index = 0; index < first.data.length; index += 4) {
    alphaMaximum = Math.max(alphaMaximum, Math.abs(first.data[index + 3] - second.data[index + 3]));
    for (let channel = 0; channel < 3; channel++) {
      const a = first.data[index + channel], b = second.data[index + channel];
      const compositeDelta = Math.abs(a * first.data[index + 3] / 255 - b * second.data[index + 3] / 255);
      compositeMaximum = Math.max(compositeMaximum, compositeDelta); compositeSum += compositeDelta;
      if (first.data[index + 3] === 255 && second.data[index + 3] === 255) {
        const delta = Math.abs(a - b); opaqueMaximum = Math.max(opaqueMaximum, delta); opaqueSum += delta; opaqueCount++;
      }
    }
  }
  return { opaqueMaximum, opaqueMean: opaqueSum / opaqueCount, alphaMaximum,
    compositeMaximum, compositeMean: compositeSum / (first.width * first.height * 3) };
}

function skinVariance(image: ImageData, band: number): number {
  let sum = 0, squares = 0, count = 0;
  for (let y = band * 48 + 4; y < band * 48 + 44; y++) for (let x = 40; x < image.width - 10; x++) {
    const index = (y * image.width + x) * 4;
    const luma = 0.299 * image.data[index] + 0.587 * image.data[index + 1] + 0.114 * image.data[index + 2];
    sum += luma; squares += luma * luma; count++;
  }
  return squares / count - (sum / count) ** 2;
}

function assertAlphaAndDetails(source: ImageData, output: ImageData, smoothingOnly: boolean) {
  for (let index = 3; index < source.data.length; index += 4) {
    check(source.data[index] === output.data[index], 'Effects changed source alpha');
  }
  for (let x = 4; x < source.width - 4; x += 2) {
    const index = (260 * source.width + x) * 4;
    check(output.data[index + 4] - output.data[index] >= 240, 'Effects reduced one-pixel black/white contrast');
  }
  if (!smoothingOnly) return;
  for (let y = 4; y < 236; y++) {
    const index = (y * source.width + 20) * 4;
    check(output.data[index] === 0 && output.data[index + 1] === 0 && output.data[index + 2] === 0,
      'Smoothing erased a one-pixel dark facial feature');
  }
  for (let y = 376; y < 408; y++) for (let x = 4; x < source.width - 4; x++) {
    const index = (y * source.width + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      check(output.data[index + channel] === source.data[index + channel], 'Smoothing blurred non-skin texture');
    }
  }
}

function initializeCpu(renderer: CameraEffectsRenderer, source: HTMLCanvasElement) {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
    return type.startsWith('webgl') || type === 'experimental-webgl' ? null : Reflect.apply(original, this, [type, ...args]);
  } as typeof original;
  try { renderer.render(source, { ...isolated, smoothing: 0.25 }); }
  finally { HTMLCanvasElement.prototype.getContext = original; }
  check(renderer.backend === 'cpu', 'The strength reference must exercise the production CPU fallback');
}

export function cameraEffectsStrengthChecks() {
  const gpu = new CameraEffectsRenderer(), cpu = new CameraEffectsRenderer();
  const source = fixture(480), original = pixels(source, source.width, source.height);
  const sheet = canvas(1920, 6 * 448), sheetContext = sheet.getContext('2d')!;
  sheetContext.fillStyle = '#171a1d'; sheetContext.fillRect(0, 0, sheet.width, sheet.height);
  const cases: { name: string; width: number; strength: number; gpuMs: number; cpuMs: number;
    difference: ReturnType<typeof compare>; skinVarianceRatios?: number[] }[] = [];
  const rows = ['smoothing', 'brightness', 'natural', 'warm', 'cool', 'mono'] as const;
  try {
    initializeCpu(cpu, source);
    for (const [row, name] of rows.entries()) for (const [column, strength] of strengths.entries()) {
      const settings = name === 'smoothing' || name === 'brightness' ? { ...isolated, [name]: strength }
        : { ...isolated, filter: name, intensity: strength };
      const gpuStart = performance.now(), rendered = gpu.render(source, settings);
      const gpuMs = performance.now() - gpuStart;
      check(gpu.backend === (strength === 0 ? 'bypass' : 'gpu'), 'Strength case did not use actual WebGL');
      const actual = pixels(rendered, source.width, source.height);
      const cpuStart = performance.now(), cpuRendered = cpu.render(source, settings);
      const cpuMs = performance.now() - cpuStart;
      check(cpu.backend === (strength === 0 ? 'bypass' : 'cpu'), 'Strength case did not use production CPU reference');
      const expected = pixels(cpuRendered, source.width, source.height), difference = compare(actual, expected);
      check(difference.opaqueMaximum <= 3 && difference.opaqueMean < 0.35
        && difference.alphaMaximum === 0 && difference.compositeMaximum <= 3 && difference.compositeMean < 0.35,
      `${name} ${strength} GPU/CPU mismatch: ${JSON.stringify(difference)}`);
      assertAlphaAndDetails(original, actual, name === 'smoothing');
      const skinVarianceRatios = name === 'smoothing'
        ? skinColors.map((_, band) => skinVariance(actual, band) / skinVariance(original, band)) : undefined;
      if (skinVarianceRatios && strength >= 0.25) {
        const limit = strength === 0.25 ? 0.8 : strength === 0.67 ? 0.5 : 0.35;
        check(skinVarianceRatios.every((ratio) => ratio < limit), `GPU smoothing does not visibly reduce skin noise: ${skinVarianceRatios}`);
      }
      cases.push({ name, width: source.width, strength, gpuMs, cpuMs, difference, skinVarianceRatios });
      sheetContext.fillStyle = '#ffffff'; sheetContext.font = '16px sans-serif';
      sheetContext.fillText(`${name} ${Math.round(strength * 100)}%`, column * 480 + 10, row * 448 + 22);
      sheetContext.drawImage(rendered, column * 480, row * 448 + 32);
    }
    const fractional = fixture(640);
    for (const filter of ['natural', 'warm', 'cool', 'mono'] as const) {
      const settings: CameraEffects = { enabled: true, smoothing: 0.67, brightness: 0.18, filter, intensity: 0.67 };
      const gpuStart = performance.now(), actual = pixels(gpu.render(fractional, settings), 640, fractional.height);
      const gpuMs = performance.now() - gpuStart;
      const cpuStart = performance.now(), expected = pixels(cpu.render(fractional, settings), 640, fractional.height);
      const cpuMs = performance.now() - cpuStart, difference = compare(actual, expected);
      check(gpu.backend === 'gpu' && cpu.backend === 'cpu', 'Fractional-radius case must exercise both real backends');
      check(difference.opaqueMaximum <= 3 && difference.opaqueMean < 0.35
        && difference.alphaMaximum === 0 && difference.compositeMaximum <= 3 && difference.compositeMean < 0.35,
      `${filter} fractional sampling GPU/CPU mismatch: ${JSON.stringify(difference)}`);
      cases.push({ name: `${filter}-fractional`, width: 640, strength: 0.67, gpuMs, cpuMs, difference });
    }
    const after = pixels(source, source.width, source.height);
    check(after.data.every((value, index) => value === original.data[index]), 'Effect checks changed the raw fixture');
    return { cases, originalUnchanged: true, physicalDevicesUsed: false, image: sheet.toDataURL('image/png') };
  } finally { gpu.dispose(); cpu.dispose(); }
}
