export const CAMERA_RESOLUTIONS = [
  { value: 'auto', label: '自动（优先流畅）', width: 0, height: 0 },
  { value: '2160p', label: '4K · 2160p', width: 3840, height: 2160 },
  { value: '1440p', label: '2K · 1440p', width: 2560, height: 1440 },
  { value: '1080p', label: '1080p', width: 1920, height: 1080 },
] as const;
export type CameraResolution = typeof CAMERA_RESOLUTIONS[number]['value'];
export interface CameraFormatPreference { resolution: CameraResolution; fps: 30 | 60 }
export interface CameraActualFormat { width: number; height: number; fps?: number }
export const DEFAULT_CAMERA_FORMAT: CameraFormatPreference = { resolution: 'auto', fps: 30 };
export const MAX_CAMERA_DIMENSION = 8192;

export function normalizeCameraFormat(value: unknown): CameraFormatPreference {
  const candidate = value && typeof value === 'object' ? value as Partial<CameraFormatPreference> : {};
  // The old default 'native' now follows automatic capture; explicit sizes remain unchanged.
  const resolution = CAMERA_RESOLUTIONS.some(item => item.value === candidate.resolution)
    ? candidate.resolution! : DEFAULT_CAMERA_FORMAT.resolution;
  return { resolution, fps: resolution !== 'auto' && candidate.fps === 60 ? 60 : 30 };
}

export function cameraActualFormat(track?: MediaStreamTrack): CameraActualFormat | undefined {
  const settings = track?.getSettings();
  if (!settings || !Number.isFinite(settings.width) || !Number.isFinite(settings.height)
    || settings.width! <= 0 || settings.height! <= 0) return;
  return { width: settings.width!, height: settings.height!,
    ...(Number.isFinite(settings.frameRate) && settings.frameRate! > 0 ? { fps: settings.frameRate } : {}) };
}

export function cameraFormatLabel(actual: CameraActualFormat): string {
  return `${actual.width} × ${actual.height}${actual.fps ? ` · ${Number(actual.fps.toFixed(2))} FPS` : ''}`;
}

/** Capabilities are independent ranges, not a promise that every size/FPS tuple works. */
export function cameraResolutionAvailable(resolution: CameraResolution, track?: MediaStreamTrack): boolean {
  if (resolution === 'auto' || !track?.getCapabilities) return true;
  try {
    const capabilities = track.getCapabilities(), target = CAMERA_RESOLUTIONS.find(item => item.value === resolution)!;
    return !(capabilities.width?.max && capabilities.width.max < target.width)
      && !(capabilities.height?.max && capabilities.height.max < target.height);
  } catch { return true; }
}

export function cameraFormatNotice(requested: CameraFormatPreference, actual?: CameraActualFormat): string | undefined {
  if (!actual) return;
  const target = CAMERA_RESOLUTIONS.find(item => item.value === requested.resolution)!;
  const sizeMismatch = target.width > 0 && (target.width !== actual.width || target.height !== actual.height);
  const rateMismatch = actual.fps !== undefined && Math.abs(actual.fps - requested.fps) > requested.fps * .03;
  if (sizeMismatch || rateMismatch) return `设备实际采集为 ${cameraFormatLabel(actual)}，未达到所选${sizeMismatch ? '分辨率' : '帧率'}`;
}
