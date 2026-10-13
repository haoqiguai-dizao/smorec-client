export type EffectsCanvas = HTMLCanvasElement | OffscreenCanvas;
export type EffectsContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(): EffectsCanvas {
  if (typeof document !== 'undefined') return document.createElement('canvas');
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
  throw new Error('当前环境无法处理摄像头画面');
}
export function context2d(canvas: EffectsCanvas): EffectsContext {
  const context = canvas.getContext('2d', { colorSpace: 'srgb' }) as EffectsContext | null;
  if (!context) throw new Error('无法创建摄像头画面处理画布');
  return context;
}
export function resizeCanvas(canvas: EffectsCanvas, width: number, height: number): boolean {
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width; canvas.height = height; return true;
}

/** Intrinsic display pixels, never CSS layout sizes or the caller's canvas/DPR. */
export function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  const value = source as unknown as Record<string, unknown>;
  let width: unknown, height: unknown;
  if ('videoWidth' in value) { width = value.videoWidth; height = value.videoHeight; }
  else if ('displayWidth' in value) { width = value.displayWidth; height = value.displayHeight; }
  else if ('naturalWidth' in value) { width = value.naturalWidth; height = value.naturalHeight; }
  else { width = value.width; height = value.height; }
  // SVGImageElement dimensions are SVGAnimatedLength, unlike raster images/canvases.
  if (typeof width === 'object' && width !== null) width = (width as SVGAnimatedLength).baseVal?.value;
  if (typeof height === 'object' && height !== null) height = (height as SVGAnimatedLength).baseVal?.value;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('摄像头画面尚未准备好，或媒体帧已关闭');
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}
