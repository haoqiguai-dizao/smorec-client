import { compositionAt, createCompositionSegment } from './composition';
import { getOutputDuration, locateClip } from './timeline';
import type { Clip, CompositionSegment, Project } from './types';

export const DIRECT_COMPOSITION_SECONDS = 3;
const EPSILON = 1e-8;

export interface CompositionSelectionOptions {
  outputTime?: number;
  clipIndex?: number;
  id?: string;
}

export interface CompositionSelection {
  segment: CompositionSegment;
  existing: boolean;
  sourceTime: number;
  outputTime: number;
  clipIndex: number;
}

interface VisibleClip { clip: Clip; index: number; offset: number }
const contains = (clip: Clip, time: number) => time >= clip.start && time < clip.end;
const endsAt = (clip: Clip, time: number) => Math.abs(time - clip.end) <= EPSILON;

function findVisibleClip(project: Project, time: number, options: CompositionSelectionOptions): VisibleClip | undefined {
  let offset = 0;
  const clips = project.clips.map((clip, index) => {
    const entry = { clip, index, offset }; offset += clip.end - clip.start; return entry;
  });
  const matches = (entry: VisibleClip | undefined) => entry && (contains(entry.clip, time) || endsAt(entry.clip, time));
  if (options.clipIndex !== undefined) {
    const hinted = clips[options.clipIndex];
    if (matches(hinted)) return hinted;
  }
  if (options.outputTime !== undefined) {
    const hinted = locateClip(project.clips, options.outputTime);
    const entry = hinted && clips[hinted.index];
    if (entry && matches(entry)) return entry;
  }
  // Source time is authoritative. A stale output cursor must not move an edit across a cut.
  return clips.find(entry => contains(entry.clip, time)) ?? clips.find(entry => endsAt(entry.clip, time));
}

/** Resolve a bounded local edit for the displayed frame, without modifying the project or history. */
export function selectCompositionAtSource(project: Project, displayedSourceTime: number,
  options: CompositionSelectionOptions = {}): CompositionSelection | undefined {
  if (!Number.isFinite(displayedSourceTime) || !Number.isFinite(project.duration) || project.duration <= 0
    || !Number.isFinite(project.fps) || project.fps <= 0 || !project.clips.length
    || project.clips.some(clip => !Number.isFinite(clip.start) || !Number.isFinite(clip.end)
      || clip.start < 0 || clip.end > project.duration || clip.end <= clip.start)) return;
  if (options.clipIndex !== undefined && (!Number.isInteger(options.clipIndex) || options.clipIndex < 0
    || options.clipIndex >= project.clips.length)) return;
  if (options.outputTime !== undefined && (!Number.isFinite(options.outputTime) || options.outputTime < 0
    || options.outputTime > getOutputDuration(project.clips) + EPSILON)) return;
  if (options.id !== undefined && (!options.id.trim() || options.id.length > 200)) return;

  const visible = findVisibleClip(project, displayedSourceTime, options);
  if (!visible) return;
  const { clip, index: clipIndex, offset } = visible;
  const frame = 1 / project.fps;
  if (clip.end - clip.start < frame - EPSILON) return;
  const sourceTime = endsAt(clip, displayedSourceTime) ? Math.max(clip.start, clip.end - frame) : displayedSourceTime;
  const outputTime = offset + sourceTime - clip.start;
  const existing = compositionAt(project.compositions, sourceTime);
  if (existing) return { segment: existing, existing: true, sourceTime, outputTime, clipIndex };

  let left = clip.start, right = clip.end;
  for (const segment of project.compositions ?? []) {
    if (segment.end <= sourceTime) left = Math.max(left, segment.end);
    if (segment.start > sourceTime) right = Math.min(right, segment.start);
  }
  if (right - left < frame - EPSILON) return;
  const end = Math.min(sourceTime + DIRECT_COMPOSITION_SECONDS, right);
  const start = end - sourceTime < DIRECT_COMPOSITION_SECONDS - EPSILON
    ? Math.max(left, end - DIRECT_COMPOSITION_SECONDS) : sourceTime;
  if (end - start < frame - EPSILON || sourceTime < start || sourceTime >= end
    || options.id && project.compositions?.some(segment => segment.id === options.id)) return;

  const segment = createCompositionSegment(project, start, end, options.id);
  // A tail edit can start earlier, but its camera must stay where the user actually clicked.
  if (start !== sourceTime && project.camera) {
    segment.camera = createCompositionSegment(project, sourceTime, end, segment.id).camera;
  }
  return { segment, existing: false, sourceTime, outputTime, clipIndex };
}
