import { CAMERA_RESOLUTIONS, DEFAULT_CAMERA_FORMAT, MAX_CAMERA_DIMENSION, type CameraFormatPreference } from './camera-format';
// Chromium implements the standardized constraint before TypeScript's DOM dictionary includes it.
export interface CameraTrackConstraints extends MediaTrackConstraints { resizeMode?: ConstrainDOMString }

/** Archive bitrate follows source detail; display-only RTC has its own viewport budget. */
export function cameraVideoBitrate(settings: Pick<MediaTrackSettings, 'width' | 'height' | 'frameRate'>): number {
  const width = Number.isFinite(settings.width) && settings.width! > 0 ? settings.width! : 1920;
  const height = Number.isFinite(settings.height) && settings.height! > 0 ? settings.height! : 1080;
  const fps = Number.isFinite(settings.frameRate) && settings.frameRate! > 0 ? Math.min(60, settings.frameRate!) : 30;
  return Math.round(Math.max(4_000_000, Math.min(80_000_000, width * height * fps * .13)));
}

export function cameraConstraints(deviceId: string, format: CameraFormatPreference = DEFAULT_CAMERA_FORMAT, compatible = false): MediaStreamConstraints {
  const target = CAMERA_RESOLUTIONS.find(item => item.value === format.resolution)!;
  const automatic = format.resolution === 'auto', fps = automatic ? 30 : format.fps;
  const video: CameraTrackConstraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    // No crop-and-scale: the source must expose these pixels in its webcam mode.
    resizeMode: { exact: 'none' },
    width: automatic ? { ideal: 1920, max: 1920 } : { exact: target.width },
    height: automatic ? { ideal: 1080, max: 1080 } : { exact: target.height },
    frameRate: compatible ? { ideal: fps } : { ideal: fps, max: fps },
  };
  return { audio: false, video };
}

/** Automatic capture limits work at the source, before recording or preview is attached. */
export async function configureCameraFormat(track: MediaStreamTrack, format: CameraFormatPreference = DEFAULT_CAMERA_FORMAT,
  signal?: AbortSignal): Promise<void> {
  const check = () => { if (signal?.aborted) throw new DOMException('摄像头连接已取消', 'AbortError'); };
  check();
  if (format.resolution === 'auto' && track.applyConstraints) {
    const requested = cameraConstraints('', format).video as CameraTrackConstraints;
    try { await track.applyConstraints(requested); }
    catch (error) {
      check();
      if (!cameraFormatUnsupported(error) || (error as Error & { constraint?: string }).constraint !== 'frameRate') throw error;
      await track.applyConstraints(cameraConstraints('', format, true).video as CameraTrackConstraints);
    }
  }
  check();
  const actual = track.getSettings();
  validateCameraDimensions(actual);
  if (format.resolution === 'auto' && ((actual.width ?? 0) > 1920 || (actual.height ?? 0) > 1080
    || (actual.frameRate ?? 0) > 30.9)) {
    throw new Error('设备未能采用自动录制规格（最高 1080p、30 FPS），请选择设备支持的录制格式');
  }
}

export function validateCameraDimensions(actual: Pick<MediaTrackSettings, 'width' | 'height'>): void {
  if ((actual.width ?? 0) > MAX_CAMERA_DIMENSION || (actual.height ?? 0) > MAX_CAMERA_DIMENSION
    || (actual.width ?? 0) * (actual.height ?? 0) > 33_177_600) {
    throw new Error(`摄像头原始格式 ${actual.width} × ${actual.height} 超过支持范围，请选择较低分辨率`);
  }
}

export function cameraFormatUnsupported(error: unknown): boolean {
  return error instanceof Error && error.name === 'OverconstrainedError'
    && (error as Error & { constraint?: string }).constraint !== 'deviceId';
}
