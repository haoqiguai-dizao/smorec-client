import type { CameraEffects } from '../../../shared/types';
import { cameraBrightnessGain, EFFECTS_KERNEL as K } from './parameters';
import { clamp, skinMask } from './skin';
import { SkinSmoothing } from './skin-smoothing';

const midtone = (color: number) => 4 * color * (1 - color);
const expose = (color: number, gain: number) => color * gain / (1 + color * (gain - 1));
function natural(color: number, luma: number, tint: number): number {
  const saturated = clamp(luma + (color - luma) * K.naturalSaturation);
  return clamp(saturated + (K.naturalContrast * (saturated - 0.5) + tint) * midtone(saturated));
}

/** Full-resolution CPU reference, also used when WebGL is unavailable. Never alters input. */
export function applyCameraEffects(input: ImageData, output: ImageData, effects: CameraEffects): void {
  const { width, height, data: source } = input, target = output.data;
  if (width !== output.width || height !== output.height) throw new RangeError('Camera effects input and output dimensions must match.');
  if (!effects.enabled) { target.set(source); return; }
  if (effects.smoothing > 0 && source.buffer === target.buffer
    && source.byteOffset < target.byteOffset + target.byteLength
    && target.byteOffset < source.byteOffset + source.byteLength) {
    throw new RangeError('Camera smoothing requires non-overlapping input and output buffers.');
  }
  const smoothing = effects.smoothing > 0 ? new SkinSmoothing(input) : undefined;
  const brightness = cameraBrightnessGain(effects.brightness), intensity = effects.intensity;
  const amount = effects.smoothing * (1 + K.smoothingCurve * (1 - effects.smoothing)) * K.smoothingMix;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = (y * width + x) * 4;
    let red = source[index] / 255, green = source[index + 1] / 255, blue = source[index + 2] / 255;
    const mask = smoothing ? skinMask(red, green, blue) : 0;
    if (smoothing && mask > 0 && source[index + 3] > 0) {
      const blend = amount * mask * smoothing.process(x, y, red, green, blue);
      red += (smoothing.tone[0] - red) * blend;
      green += (smoothing.tone[1] - green) * blend;
      blue += (smoothing.tone[2] - blue) * blend;
    }
    red = expose(red, brightness); green = expose(green, brightness); blue = expose(blue, brightness);
    if (intensity > 0) {
      const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
      let filteredRed: number, filteredGreen: number, filteredBlue: number;
      if (effects.filter === 'mono') filteredRed = filteredGreen = filteredBlue = luma;
      else if (effects.filter === 'warm' || effects.filter === 'cool') {
        const tint = effects.filter === 'warm' ? K.warmTint : K.coolTint;
        filteredRed = clamp(red + tint[0] * midtone(red));
        filteredGreen = clamp(green + tint[1] * midtone(green));
        filteredBlue = clamp(blue + tint[2] * midtone(blue));
      } else {
        filteredRed = natural(red, luma, K.naturalTint[0]);
        filteredGreen = natural(green, luma, K.naturalTint[1]);
        filteredBlue = natural(blue, luma, K.naturalTint[2]);
      }
      red += (filteredRed - red) * intensity;
      green += (filteredGreen - green) * intensity;
      blue += (filteredBlue - blue) * intensity;
    }
    target[index] = clamp(red) * 255; target[index + 1] = clamp(green) * 255;
    target[index + 2] = clamp(blue) * 255; target[index + 3] = source[index + 3];
  }
}
