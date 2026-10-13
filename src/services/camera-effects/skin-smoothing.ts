import { EFFECTS_KERNEL as K } from './parameters';
import { samplePixel } from './sampling';
import { smoothstep } from './skin';

/** A frame-local workspace. No allocation inside either pixel or sampling loop. */
export class SkinSmoothing {
  readonly fine = new Float64Array(3);
  readonly tone = new Float64Array(3);
  private readonly sample = new Float64Array(4);
  private readonly micro: number;
  private readonly radius: number;

  constructor(private readonly input: ImageData) {
    const size = Math.max(input.width, input.height);
    this.micro = Math.max(1, size * K.microRadiusScale);
    this.radius = Math.max(1, size * K.toneRadiusScale);
  }

  private bilateral(x: number, y: number, red: number, green: number, blue: number,
    radius: number, extent: number, result: Float64Array): void {
    if (Number.isInteger(radius)) {
      this.integerBilateral(x, y, red, green, blue, radius, extent, result);
      return;
    }
    result.fill(0);
    let total = 0;
    const { data, width, height } = this.input, sample = this.sample;
    for (let dy = -extent; dy <= extent; dy++) for (let dx = -extent; dx <= extent; dx++) {
      samplePixel(data, width, height, x + dx * radius, y + dy * radius, sample);
      if (sample[3] <= 0) continue;
      const dr = sample[0] - red, dg = sample[1] - green, db = sample[2] - blue;
      const distance = dr * dr + dg * dg + db * db;
      const wx = extent === 1 ? (dx === 0 ? 2 : 1) : (dx === 0 ? 6 : Math.abs(dx) === 1 ? 4 : 1);
      const wy = extent === 1 ? (dy === 0 ? 2 : 1) : (dy === 0 ? 6 : Math.abs(dy) === 1 ? 4 : 1);
      const weight = wx * wy * (1 - smoothstep(K.bilateralEdge[0], K.bilateralEdge[1], distance))
        / (1 + K.bilateralFalloff * distance) * sample[3];
      for (let channel = 0; channel < 3; channel++) result[channel] += sample[channel] * weight;
      total += weight;
    }
    if (total > 0) for (let channel = 0; channel < 3; channel++) result[channel] /= total;
    else { result[0] = red; result[1] = green; result[2] = blue; }
  }

  /** Common 480p/1080p/4K path: avoid interpolation and typed-array writes per tap. */
  private integerBilateral(x: number, y: number, red: number, green: number, blue: number,
    radius: number, extent: number, result: Float64Array): void {
    const { width, height, data } = this.input;
    const r = red * 255, g = green * 255, b = blue * 255;
    let sumR = 0, sumG = 0, sumB = 0, total = 0;
    for (let dy = -extent; dy <= extent; dy++) {
      const row = Math.max(0, Math.min(height - 1, y + dy * radius)) * width;
      const wy = extent === 1 ? (dy === 0 ? 2 : 1) : (dy === 0 ? 6 : Math.abs(dy) === 1 ? 4 : 1);
      for (let dx = -extent; dx <= extent; dx++) {
        const index = (row + Math.max(0, Math.min(width - 1, x + dx * radius))) * 4;
        const alpha = data[index + 3]; if (!alpha) continue;
        const dr = data[index] - r, dg = data[index + 1] - g, db = data[index + 2] - b;
        const distance = (dr * dr + dg * dg + db * db) / 65025;
        const wx = extent === 1 ? (dx === 0 ? 2 : 1) : (dx === 0 ? 6 : Math.abs(dx) === 1 ? 4 : 1);
        const weight = wx * wy * (1 - smoothstep(K.bilateralEdge[0], K.bilateralEdge[1], distance))
          / (1 + K.bilateralFalloff * distance) * alpha;
        sumR += data[index] * weight; sumG += data[index + 1] * weight; sumB += data[index + 2] * weight;
        total += weight;
      }
    }
    if (total > 0) {
      const scale = 1 / (255 * total); result[0] = sumR * scale; result[1] = sumG * scale; result[2] = sumB * scale;
    } else { result[0] = red; result[1] = green; result[2] = blue; }
  }

  /** Frequency separation: smooth tone/chroma, restore a bounded luminance detail layer. */
  process(x: number, y: number, red: number, green: number, blue: number): number {
    this.bilateral(x, y, red, green, blue, this.micro, 1, this.fine);
    this.bilateral(x, y, red, green, blue, this.radius, 2, this.tone);
    const detail = (red - this.fine[0]) * 0.299 + (green - this.fine[1]) * 0.587
      + (blue - this.fine[2]) * 0.114;
    const restore = detail * K.detailRetention;
    // Bound to the source/base envelope, so detail restoration cannot create halos.
    this.tone[0] = Math.max(Math.min(red, this.tone[0]), Math.min(Math.max(red, this.tone[0]), this.tone[0] + restore));
    this.tone[1] = Math.max(Math.min(green, this.tone[1]), Math.min(Math.max(green, this.tone[1]), this.tone[1] + restore));
    this.tone[2] = Math.max(Math.min(blue, this.tone[2]), Math.min(Math.max(blue, this.tone[2]), this.tone[2] + restore));
    return 1 - smoothstep(K.detailProtection[0], K.detailProtection[1], Math.abs(detail));
  }
}
