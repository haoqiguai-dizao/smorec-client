import { buildAutoZooms } from './auto-zoom';
import { cursorOutsideWhiteboard, inputOutsideWhiteboard, whiteboardFocusActivity } from './auto-zoom/whiteboard';
import { continuousCameraAt } from './auto-zoom/camera';
import type { Clip, CursorSample, InputActivity, Project, ZoomSegment } from './types';

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const getOutputDuration = (clips: Clip[]) => clips.reduce((sum, clip) => sum + Math.max(0, clip.end - clip.start), 0);

export function outputToSourceTime(clips: Clip[], time: number): number {
  let remaining = Math.max(0, time);
  for (const clip of clips) {
    const length = Math.max(0, clip.end - clip.start);
    if (remaining < length) return clip.start + remaining;
    remaining -= length;
  }
  return clips.at(-1)?.end ?? 0;
}

export function sourceToOutputTime(clips: Clip[], time: number): number {
  let output = 0;
  for (const clip of clips) {
    if (time < clip.start) return output;
    if (time <= clip.end) return output + time - clip.start;
    output += clip.end - clip.start;
  }
  return output;
}

export function locateClip(clips: Clip[], time: number): { clip: Clip; index: number; offset: number } | null {
  let offset = 0;
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index];
    if (time < offset + clip.end - clip.start || index === clips.length - 1) return { clip, index, offset };
    offset += clip.end - clip.start;
  }
  return null;
}

export function splitClip(clips: Clip[], outputTime: number, minLength = 1 / 30): Clip[] {
  const position = locateClip(clips, outputTime);
  if (!position) return clips;
  const time = position.clip.start + outputTime - position.offset;
  if (time - position.clip.start < minLength || position.clip.end - time < minLength) return clips;
  return clips.flatMap((clip, index) => index === position.index
    ? [{ ...clip, end: time }, { id: crypto.randomUUID(), start: time, end: clip.end }]
    : [clip]);
}

/** A deterministic, editable camera plan from screen and whiteboard activity. */
export function generateAutoZooms(cursor: CursorSample[], duration: number, inputActivity?: InputActivity[],
  board?: Pick<Project, 'whiteboard' | 'width' | 'height'>): ZoomSegment[] {
  const whiteboard = board?.whiteboard;
  const activity = whiteboardFocusActivity(whiteboard, duration, board?.width ?? 0, board?.height ?? 0);
  const screenInput = inputOutsideWhiteboard(inputActivity, whiteboard);
  const zooms = buildAutoZooms(cursorOutsideWhiteboard(cursor, whiteboard), duration,
    activity.length ? [...(screenInput ?? []), ...activity] : screenInput);
  const exits = whiteboard?.events.filter(event => event.action.kind === 'layout'
    && (!event.action.visible || event.action.passthrough)).map(event => event.t) ?? [];
  return zooms.map(zoom => exits.some(t => t >= zoom.start && t <= zoom.end)
    ? { ...zoom, exitToFullView: true } : zoom);
}

export function cameraAt(zooms: ZoomSegment[], time: number) {
  return continuousCameraAt(zooms, time);
}

export function sampleIndexAt(samples: CursorSample[], time: number): number {
  let low = 0, high = samples.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (samples[middle].t <= time) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

export function cursorAt(samples: CursorSample[], time: number, smoothing: number): CursorSample | null {
  if (!samples.length || time < samples[0].t) return null;
  const index = sampleIndexAt(samples, time);
  const current = samples[index];
  const next = samples[index + 1] ?? current;
  const ratio = next.t > current.t ? clamp((time - current.t) / (next.t - current.t), 0, 1) : 0;
  let x = current.x + (next.x - current.x) * ratio;
  let y = current.y + (next.y - current.y) * ratio;
  const window = Math.max(0, smoothing) * 0.12;
  if (window > 0.001) {
    let total = 0, sumX = 0, sumY = 0;
    for (let i = Math.max(0, index - 24); i < Math.min(samples.length, index + 25); i++) {
      const sample = samples[i];
      const weight = Math.max(0, 1 - Math.abs(sample.t - time) / window);
      if (sample.visible) { total += weight; sumX += sample.x * weight; sumY += sample.y * weight; }
    }
    if (total > 0) { x = sumX / total; y = sumY / total; }
  }
  // Anchor the cursor to an actual click so smoothing never points at the wrong target.
  const anchor = samples.slice(Math.max(0, index - 10), index + 11)
    .filter((sample) => sample.click && Math.abs(sample.t - time) < 0.1)
    .sort((a, b) => Math.abs(a.t - time) - Math.abs(b.t - time))[0];
  if (anchor) {
    const weight = 1 - Math.abs(anchor.t - time) / 0.1;
    x += (anchor.x - x) * weight;
    y += (anchor.y - y) * weight;
  }
  return { ...current, t: time, x, y };
}
