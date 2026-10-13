import type { CameraMode, WebcamStyle } from './types';

/** Mode changes are hard cuts on screen source time, unaffected by camera offset or layout edits. */
export function cameraModeAt(style: WebcamStyle | undefined, time: number): CameraMode {
  const fallback = style?.mode ?? 'overlay';
  const frames = style?.modeKeyframes;
  if (style?.useRecordedMode === false || !frames?.length || !Number.isFinite(time)) return fallback;
  let low = 0, high = frames.length - 1, index = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].t <= time) { index = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return index < 0 ? fallback : frames[index].mode;
}
