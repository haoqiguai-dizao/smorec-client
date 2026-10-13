import { BACKGROUNDS } from '../../shared/constants';
import type { CompositionSegment } from '../../shared/types';
import { sourceSize } from './camera-effects/canvas';
import { effectiveBackground } from '../../shared/backgrounds';

/** A missing replacement remains blank; it must never fall back to private screen pixels. */
export function drawCompositionBackground(ctx: CanvasRenderingContext2D, segment: CompositionSegment | undefined,
  fallback: string, width: number, height: number, image?: CanvasImageSource): void {
  const id = effectiveBackground(fallback, segment);
  if (!id || (id.startsWith('asset:') && !image)) {
    ctx.fillStyle = '#13151a'; ctx.fillRect(0, 0, width, height);
    return;
  }
  if (id.startsWith('asset:') && image) {
    ctx.fillStyle = '#13151a'; ctx.fillRect(0, 0, width, height);
    const size = sourceSize(image), scale = Math.max(width / size.width, height / size.height);
    ctx.drawImage(image, (width - size.width * scale) / 2, (height - size.height * scale) / 2, size.width * scale, size.height * scale);
    return;
  }
  const colors = BACKGROUNDS.find((background) => background.id === id)?.colors ?? BACKGROUNDS[0].colors;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), color));
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
}
