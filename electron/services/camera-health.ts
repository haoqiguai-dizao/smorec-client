/** Compare timeline coverage, allowing small encoder/frame rounding differences. */
export function cameraCoverageWarning(duration: number, offset: number, screenDuration?: number): string | undefined {
  if (screenDuration === undefined || !Number.isFinite(screenDuration) || screenDuration <= 0) return;
  const covered = Math.max(0, Math.min(screenDuration, duration - offset) - Math.max(0, -offset));
  const tolerance = Math.max(0.5, Math.min(2, screenDuration * 0.05));
  if (screenDuration - covered <= tolerance) return;
  return `摄像头仅覆盖 ${covered.toFixed(1)} 秒，屏幕录制为 ${screenDuration.toFixed(1)} 秒；已录到的摄像头原片仍已保留，请检查缺失时段`;
}

export const CAMERA_DATA_WAITING = '摄像头编码数据已超过 5 秒未刷新，正在等待；屏幕仍在录制';

const CAMERA_FRAMES_STALLED_PREFIX = '摄像头画面已超过';

/**
 * Raised from the recorder's own frame clock. The byte-level `CameraDataHealth` cannot see this
 * failure: the recorder forces a `requestData()` flush every second, so chunks keep arriving after
 * the encoder has already stopped producing frames.
 */
export const cameraFramesStalled = (seconds: number): string =>
  `${CAMERA_FRAMES_STALLED_PREFIX} ${Math.max(5, Math.round(seconds))} 秒没有新画面，编码可能已被拖慢；屏幕仍在录制`;

/** Transient camera notices clear once the same source recovers; real faults are never cleared. */
export const isCameraTransientWarning = (warning: string): boolean =>
  warning === CAMERA_DATA_WAITING || warning.startsWith(CAMERA_FRAMES_STALLED_PREFIX);

export class CameraDataHealth {
  private lastDataAt: number;
  private warned = false;
  constructor(startedAt: number) { this.lastDataAt = startedAt; }
  append(now: number): boolean {
    const resumed = this.warned;
    this.lastDataAt = now; this.warned = false;
    return resumed;
  }
  warning(now: number): string | undefined {
    if (this.warned || now - this.lastDataAt < 5000) return;
    this.warned = true;
    return CAMERA_DATA_WAITING;
  }
}
