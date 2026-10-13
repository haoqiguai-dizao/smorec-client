import type { ZoomSegment } from '../types';
import { AUTO_ZOOM_EASE_SECONDS } from './constants';

const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
const smooth = (v: number) => { const t = clamp(v, 0, 1); return t * t * (3 - 2 * t); };
const full = { scale: 1, x: .5, y: .5 };
const bridgeGap = .8;

function frame(shot: Pick<ZoomSegment, 'scale' | 'x' | 'y'>) {
  const scale = Math.max(1, shot.scale), margin = .5 / scale;
  return { scale, x: clamp(shot.x, margin, 1 - margin), y: clamp(shot.y, margin, 1 - margin) };
}
function mix(a: typeof full, b: typeof full, ratio: number) {
  const t = smooth(ratio);
  return frame({ scale: a.scale + (b.scale - a.scale) * t,
    x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}
function joined(a: ZoomSegment, b: ZoomSegment) {
  return !a.exitToFullView && b.start >= a.end && b.start - a.end <= bridgeGap;
}

/** Nearby shots form one camera move; only the outside edges return to full view. */
export function continuousCameraAt(zooms: ZoomSegment[], time: number) {
  // The editable timeline normally stays sorted, but manual movement can change order.
  const shots = zooms.some((shot, i) => i > 0 && shot.start < zooms[i - 1].start)
    ? zooms.toSorted((a, b) => a.start - b.start) : zooms;
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i], next = shots[i + 1];
    if (next && joined(shot, next)) {
      const out = Math.min(AUTO_ZOOM_EASE_SECONDS, (shot.end - shot.start) / 3);
      const into = Math.min(AUTO_ZOOM_EASE_SECONDS, (next.end - next.start) / 3);
      const start = shot.end - out, end = next.start + into;
      if (time >= start && time <= end) return mix(frame(shot), frame(next), (time - start) / (end - start));
    }
    if (time < shot.start || time > shot.end) continue;
    const ease = Math.min(AUTO_ZOOM_EASE_SECONDS, (shot.end - shot.start) / 2);
    const entering = i === 0 || !joined(shots[i - 1], shot);
    const leaving = !next || !joined(shot, next);
    if (entering && time < shot.start + ease) return mix(full, frame(shot), (time - shot.start) / ease);
    if (leaving && time > shot.end - ease) return mix(frame(shot), full, (time - shot.end + ease) / ease);
    return frame(shot);
  }
  return { ...full };
}
