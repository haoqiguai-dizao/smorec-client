/** CSS display demand, independent of the original camera recording format. */
export interface CameraPreviewViewport {
  width: number;
  height: number;
  density: number;
  visible: boolean;
  revision: number;
}
export type CameraPreviewDisplay = Omit<CameraPreviewViewport, 'revision'>;

export function validCameraPreviewViewport(value: unknown): value is CameraPreviewViewport {
  if (!value || typeof value !== 'object') return false;
  const viewport = value as CameraPreviewViewport;
  return typeof viewport.visible === 'boolean'
    && Number.isInteger(viewport.revision) && viewport.revision >= 1 && viewport.revision <= 0x7fffffff
    && Number.isFinite(viewport.density) && viewport.density >= .5 && viewport.density <= 8
    && [viewport.width, viewport.height].every(size => Number.isFinite(size) && size >= 0 && size <= 8192);
}

/**
 * The floating preview has a 720p pixel budget, independent of the saved camera source.
 * Under pressure reduce pixels first so pointer movement and speech remain continuous.
 */
export const CAMERA_PREVIEW_TIERS = [
  { scale: 1, bitrate: 1, frameRate: 1 },
  { scale: .85, bitrate: 1, frameRate: 1 },
  { scale: 2 / 3, bitrate: 1, frameRate: 1 },
  { scale: .5, bitrate: 1, frameRate: .8 },
] as const;
export const MAX_CAMERA_PREVIEW_TIER = CAMERA_PREVIEW_TIERS.length - 1;
export type CameraPreviewTier = 0 | 1 | 2 | 3;

export function normalizeCameraPreviewTier(value: unknown): CameraPreviewTier {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_CAMERA_PREVIEW_TIER
    ? value as CameraPreviewTier : 0;
}

/** One RTC scale must yield even width AND height or H.264 silently falls back to CPU. */
export function cameraPreviewEncoding(source: { width: number; height: number; frameRate?: number }, viewport: CameraPreviewViewport,
  tier: CameraPreviewTier = 0) {
  const width = Math.max(1, source.width || 1920), height = Math.max(1, source.height || 1080);
  const load = CAMERA_PREVIEW_TIERS[tier] ?? CAMERA_PREVIEW_TIERS[0];
  const scale = Math.min(1, 1280 / Math.max(width, height), Math.sqrt(1280 * 720 / (width * height)),
    Math.max(viewport.width * viewport.density / width, viewport.height * viewport.density / height)) * load.scale;
  let divisor = width, remainder = height;
  while (remainder) { const next = divisor % remainder; divisor = remainder; remainder = next; }
  const steps = Math.max(1, Math.floor(divisor / 2));
  // E.g. 1920×1080 needs multiples of 32×18. Independently rounding each edge
  // can still produce 922×519 after aspect-preserving RTC scaling.
  // The tiny upward bias prevents floating-point truncation losing a pixel.
  const alignedScale = Math.min(1, Math.ceil(scale * steps) / steps + 1e-9);
  const tieredScale = Math.max(1 / steps, alignedScale);
  const encodedWidth = Math.floor(width * tieredScale), encodedHeight = Math.floor(height * tieredScale);
  const frameRate = Math.max(1, Math.round(Math.min(30, Math.max(1, source.frameRate || 30)) * load.frameRate));
  return {
    active: viewport.visible && viewport.width > 0 && viewport.height > 0,
    scaleResolutionDownBy: tieredScale > 0 ? 1 / tieredScale : 1,
    maxFramerate: frameRate,
    maxBitrate: Math.round(Math.max(750_000, Math.min(12_000_000, encodedWidth * encodedHeight * frameRate * .13 * load.bitrate))),
  };
}
