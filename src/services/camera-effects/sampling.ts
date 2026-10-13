/** Premultiplied bilinear sampling, matching the WebGL input texture. */
export function samplePixel(source: Uint8ClampedArray, width: number, height: number,
  x: number, y: number, result: Float64Array): void {
  x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const topLeft = (y0 * width + x0) * 4;
  if (fx === 0 && fy === 0) {
    result[0] = source[topLeft] / 255; result[1] = source[topLeft + 1] / 255;
    result[2] = source[topLeft + 2] / 255; result[3] = source[topLeft + 3] / 255;
    return;
  }
  const topRight = (y0 * width + Math.min(width - 1, x0 + 1)) * 4;
  const bottomLeft = (Math.min(height - 1, y0 + 1) * width + x0) * 4;
  const bottomRight = (Math.min(height - 1, y0 + 1) * width + Math.min(width - 1, x0 + 1)) * 4;
  const w00 = (1 - fx) * (1 - fy) * source[topLeft + 3] / 255;
  const w10 = fx * (1 - fy) * source[topRight + 3] / 255;
  const w01 = (1 - fx) * fy * source[bottomLeft + 3] / 255;
  const w11 = fx * fy * source[bottomRight + 3] / 255;
  const alpha = w00 + w10 + w01 + w11;
  result[3] = alpha;
  const scale = alpha > 0 ? 1 / (255 * alpha) : 0;
  for (let channel = 0; channel < 3; channel++) result[channel] = (source[topLeft + channel] * w00
    + source[topRight + channel] * w10 + source[bottomLeft + channel] * w01
    + source[bottomRight + channel] * w11) * scale;
}
