import type { CompositionSegment, Project } from '../../shared/types';
import { drawCompositionBackground } from './composition-background';

export function screenGeometry(project: Project, width: number, height: number) {
  const unit = Math.min(width, height) / 1080;
  const padding = Math.min(project.style.padding * unit, Math.min(width, height) * 0.4);
  const fit = Math.min((width - padding * 2) / project.width, (height - padding * 2) / project.height);
  const frameWidth = project.width * fit, frameHeight = project.height * fit;
  return { unit, frameWidth, frameHeight, left: (width - frameWidth) / 2, top: (height - frameHeight) / 2,
    radius: Math.min(project.style.radius * unit, frameHeight / 2, frameWidth / 2) };
}

interface Decoration { canvas: HTMLCanvasElement; key: string; image?: CanvasImageSource }
const decorations = new WeakMap<CanvasRenderingContext2D, Decoration>();
// One opaque layer per composition surface, at most 32 MiB of RGBA backing pixels.
const MAX_CACHE_PIXELS = 3840 * 2160;

export function disposeCompositionDecoration(ctx: CanvasRenderingContext2D): void {
  const entry = decorations.get(ctx);
  if (entry) { entry.canvas.width = 1; entry.canvas.height = 1; decorations.delete(ctx); }
}

function paint(ctx: CanvasRenderingContext2D, project: Project, width: number, height: number,
  segment?: CompositionSegment, image?: CanvasImageSource): void {
  drawCompositionBackground(ctx, segment, project.style.background, width, height, image);
  if (segment && segment.screen !== 'recording') return;
  const { unit, left, top, frameWidth, frameHeight, radius } = screenGeometry(project, width, height);
  ctx.shadowColor = '#10152280'; ctx.shadowBlur = project.style.shadow * unit;
  ctx.shadowOffsetY = project.style.shadow * unit * 0.35;
  ctx.fillStyle = '#13151a';
  ctx.beginPath(); ctx.roundRect(left, top, frameWidth, frameHeight, radius); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
}

/** Cache only immutable decoration. Video, camera, cursor, zoom and effects are drawn every output frame. */
export function drawCompositionDecoration(ctx: CanvasRenderingContext2D, project: Project, width: number, height: number,
  segment?: CompositionSegment, image?: CanvasImageSource): void {
  if (width * height > MAX_CACHE_PIXELS || typeof document === 'undefined') {
    disposeCompositionDecoration(ctx); paint(ctx, project, width, height, segment, image); return;
  }
  const key = JSON.stringify([width, height, project.width, project.height, project.style.background,
    project.style.padding, project.style.radius, project.style.shadow, segment?.screen, segment?.background]);
  let entry = decorations.get(ctx);
  if (!entry) { entry = { canvas: document.createElement('canvas'), key: '' }; decorations.set(ctx, entry); }
  if (entry.key !== key || entry.image !== image) {
    const canvas = entry.canvas;
    canvas.width = width; canvas.height = height;
    const layer = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    if (!layer) { disposeCompositionDecoration(ctx); paint(ctx, project, width, height, segment, image); return; }
    paint(layer, project, width, height, segment, image);
    entry.key = key; entry.image = image;
  }
  ctx.drawImage(entry.canvas, 0, 0);
}
