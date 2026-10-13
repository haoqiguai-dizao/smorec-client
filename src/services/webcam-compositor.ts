import { cameraZoom } from '../../shared/camera-zoom';
import { presenterSourceRect } from '../../shared/presenter';
import type { CameraEffects, WebcamStyle } from '../../shared/types';
import { hasFaceEffects } from '../../shared/beauty';
import { cameraShapeGeometry } from '../../shared/camera-shapes';
import { CameraEffectsRenderer } from './camera-effects/renderer';
import { CameraPreviewRenderer } from './camera-effects/preview-renderer';
import { sourceSize } from './camera-effects/canvas';

export type CameraRenderMode = 'source' | 'preview';
const effectsRenderers = new WeakMap<CanvasRenderingContext2D, {
  source?: CameraEffectsRenderer; preview?: CameraPreviewRenderer;
}>();
export function disposeWebcamEffects(context: CanvasRenderingContext2D): void {
  const renderers = effectsRenderers.get(context);
  renderers?.source?.dispose(); renderers?.preview?.dispose(); effectsRenderers.delete(context);
}

export async function prepareWebcamEffects(context: CanvasRenderingContext2D, source: CanvasImageSource, effects?: CameraEffects, outputIndex?: number): Promise<void> {
  if (!hasFaceEffects(effects)) return;
  let renderers = effectsRenderers.get(context);
  if (!renderers) { renderers = {}; effectsRenderers.set(context, renderers); }
  renderers.source ??= new CameraEffectsRenderer();
  await renderers.source.prepare(source, effects, outputIndex);
}

function processedCamera(ctx: CanvasRenderingContext2D, video: CanvasImageSource, style: WebcamStyle,
  display: { width: number; height: number }, mode: CameraRenderMode): CanvasImageSource {
  if (style.effects?.enabled) {
    let renderers = effectsRenderers.get(ctx);
    if (!renderers) { renderers = {}; effectsRenderers.set(ctx, renderers); }
    if (mode === 'preview') {
      renderers.preview ??= new CameraPreviewRenderer();
      // Display is already measured in the budgeted canvas's backing pixels, including DPR.
      video = renderers.preview.render(video, style.effects, display, 1)?.source ?? video;
    } else {
      renderers.source ??= new CameraEffectsRenderer();
      video = renderers.source.render(video, style.effects);
    }
  }
  return video;
}

/** Full-canvas composition ignores the saved small-window geometry and screen zoom. */
export function drawPresenter(ctx: CanvasRenderingContext2D, video: CanvasImageSource, style: WebcamStyle, width: number, height: number,
  mode: CameraRenderMode = 'source'): void {
  video = processedCamera(ctx, video, style, { width, height }, mode);
  const { width: sourceWidth, height: sourceHeight } = sourceSize(video);
  const crop = presenterSourceRect(sourceWidth, sourceHeight, width, height, style.presenterCrop, style.zoom);
  ctx.save();
  try {
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.translate(width / 2, height / 2);
    if (style.mirror) ctx.scale(-1, 1);
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height,
      -width / 2, -height / 2, width, height);
  } finally { ctx.restore(); }
}

export function drawWebcam(ctx: CanvasRenderingContext2D, video: CanvasImageSource, style: WebcamStyle, width: number, height: number, zoom: number,
  mode: CameraRenderMode = 'source') {
  const shrink = style.shrinkOnZoom ? 1 - Math.min(1, Math.max(0, zoom - 1)) * 0.24 : 1;
  const { width: size, height: frameHeight, radius } = cameraShapeGeometry(style.shape, Math.min(width, height) * style.size * shrink, width, height);
  video = processedCamera(ctx, video, style, { width: size, height: frameHeight }, mode);
  const { width: sourceWidth, height: sourceHeight } = sourceSize(video);
  const gap = Math.min(width, height) * 0.035;
  const left = style.placement ? Math.max(0, Math.min(width - size, style.placement.x * width - size / 2))
    : style.position.endsWith('right') ? width - gap - size : gap;
  const top = style.placement ? Math.max(0, Math.min(height - frameHeight, style.placement.y * height - frameHeight / 2))
    : style.position.startsWith('bottom') ? height - gap - frameHeight : gap;
  ctx.save();
  ctx.shadowColor = '#00000065'; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.035;
  ctx.fillStyle = '#202228';
  ctx.beginPath(); ctx.roundRect(left, top, size, frameHeight, radius); ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.beginPath(); ctx.roundRect(left, top, size, frameHeight, radius); ctx.clip();
  const scale = Math.max(size / sourceWidth, frameHeight / sourceHeight) * cameraZoom(style.zoom);
  ctx.translate(left + size / 2, top + frameHeight / 2);
  if (style.mirror) ctx.scale(-1, 1);
  ctx.drawImage(video, -sourceWidth * scale / 2, -sourceHeight * scale / 2, sourceWidth * scale, sourceHeight * scale);
  ctx.restore();
}
