import type { CameraEffectsBackend } from './renderer';

const CPU_PREVIEW_INTERVAL_MS = 1000 / 15;
export const CAMERA_PREVIEW_FRAME_MS = 1000 / 30;

/** Cover the on-screen camera rectangle at native display density, without upscaling the source. */
export function cameraPreviewSize(source: { width: number; height: number },
  display: { width: number; height: number }, density: number): { width: number; height: number } | null {
  if (![source.width, source.height, display.width, display.height].every(value => Number.isFinite(value) && value > 0)) return null;
  const dpr = Number.isFinite(density) && density > 0 ? density : 1;
  const scale = Math.min(1, Math.max(display.width * dpr / source.width, display.height * dpr / source.height));
  return { width: Math.max(1, Math.ceil(source.width * scale)), height: Math.max(1, Math.ceil(source.height * scale)) };
}

export function cameraPreviewNextPaint(started: number, finished: number, backend: CameraEffectsBackend): number {
  return Math.max(started + CAMERA_PREVIEW_FRAME_MS, finished + cameraPreviewCooldown(backend, finished - started));
}

/** Delay after painting, not a frame-size budget. Export never uses this preview policy. */
export function cameraPreviewCooldown(backend: CameraEffectsBackend, renderMilliseconds: number): number {
  if (backend !== 'cpu') return 0;
  const elapsed = Number.isFinite(renderMilliseconds) ? Math.max(0, renderMilliseconds) : 0;
  // Leave at least as much time for other work as this CPU frame consumed.
  return Math.max(elapsed, CPU_PREVIEW_INTERVAL_MS - elapsed);
}
