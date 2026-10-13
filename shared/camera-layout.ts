import { cameraZoom } from './camera-zoom';
import type { WebcamStyle } from './types';
import { cameraEffectsAt } from './camera-effects';

/** Camera layout uses source time, so cuts and exports keep the same movements. */
export function webcamStyleAt(style: WebcamStyle, time: number): WebcamStyle {
  const effects = cameraEffectsAt(style, time);
  const effective = style.effects !== undefined || style.effectKeyframes !== undefined ? { ...style, effects } : style;
  const frames = style.keyframes;
  if (!frames?.length) return effective;
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].t <= time) low = middle; else high = middle - 1;
  }
  const current = frames[low], next = frames[low + 1];
  if (!style.enabled || style.useRecordedLayout === false) {
    return style.useRecordedMirror === true ? { ...effective, mirror: current.mirror } : effective;
  }
  // Interpolate closely spaced drag samples, never anticipate a later deliberate change.
  const fraction = next && next.t - current.t <= 0.25 && next.t > current.t
    ? Math.max(0, Math.min(1, (time - current.t) / (next.t - current.t))) : 0;
  return { ...effective, enabled: style.enabled && current.visible, shape: current.shape,
    mirror: style.useRecordedMirror === false ? style.mirror : current.mirror,
    ...((current.zoom ?? next?.zoom ?? style.zoom) === undefined ? {} : {
      zoom: cameraZoom(current.zoom) + (cameraZoom(next ? next.zoom : current.zoom) - cameraZoom(current.zoom)) * fraction }),
    size: current.size + ((next?.size ?? current.size) - current.size) * fraction,
    placement: { x: current.x + ((next?.x ?? current.x) - current.x) * fraction,
      y: current.y + ((next?.y ?? current.y) - current.y) * fraction } };
}
