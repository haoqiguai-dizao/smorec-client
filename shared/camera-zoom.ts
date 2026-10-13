export const CAMERA_ZOOM_MIN = 1;
export const CAMERA_ZOOM_MAX = 3;

/** Centered digital zoom. Missing values keep legacy projects at their original framing. */
export function cameraZoom(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(CAMERA_ZOOM_MIN, Math.min(CAMERA_ZOOM_MAX, value)) : CAMERA_ZOOM_MIN;
}
