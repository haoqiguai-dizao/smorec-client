import { getExportCanvasSize } from './canvas';
import { webcamStyleAt } from './camera-layout';
import { cameraModeAt } from './camera-modes';
import { compositionCameraRect } from './composition-camera';
import { cameraAt } from './timeline';
import { validCompositionDraft } from './composition-validation';
import type { CompositionSegment, Project } from './types';

export type CompositionPatch = Omit<Partial<CompositionSegment>, 'id'>;

export function compositionAt(segments: readonly CompositionSegment[] | undefined, time: number): CompositionSegment | undefined {
  if (!segments?.length || !Number.isFinite(time)) return undefined;
  let low = 0, high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1, segment = segments[middle];
    if (time < segment.start) high = middle - 1;
    else if (time >= segment.end) low = middle + 1;
    else return segment;
  }
  return undefined;
}

function validRange(segment: Pick<CompositionSegment, 'start' | 'end'>, duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && Number.isFinite(segment.start) && Number.isFinite(segment.end)
    && segment.start >= 0 && segment.end <= duration && segment.end > segment.start;
}

const clone = (segment: CompositionSegment): CompositionSegment => ({ ...segment,
  ...(segment.camera ? { camera: { ...segment.camera } } : {}) });

function includesPresenter(project: Project, start: number, end: number): boolean {
  if (cameraModeAt(project.camera, start) === 'presenter') return true;
  if (project.camera?.useRecordedMode === false) return false;
  return project.camera?.modeKeyframes?.some((frame) => frame.t > start && frame.t < end
    && frame.mode === 'presenter' && cameraModeAt(project.camera, frame.t) === 'presenter') ?? false;
}

/** Freeze the current small-window layout, without changing its saved tracks or size. */
export function createCompositionSegment(project: Project, start: number, end: number, id: string = crypto.randomUUID()): CompositionSegment {
  if (!validRange({ start, end }, project.duration)) throw new RangeError('镜头片段时间范围无效');
  const current = compositionAt(project.compositions, start);
  const segment: CompositionSegment = { id, start, end,
    screen: current?.screen ?? (includesPresenter(project, start, end) ? 'hidden' : 'recording'),
    ...(current?.background ? { background: current.background } : {}) };
  if (project.camera) {
    const { width, height } = getExportCanvasSize(project), style = webcamStyleAt(project.camera, start);
    const camera = current?.camera;
    const rect = compositionCameraRect(style, camera, width, height, cameraAt(project.zooms, start).scale);
    const visible = camera?.visible ?? (!current && cameraModeAt(project.camera, start) === 'presenter'
      ? project.camera.enabled : style.enabled);
    segment.camera = { ...(camera?.zoom === undefined ? {} : { zoom: camera.zoom }), x: rect.x / width, y: rect.y / height, size: rect.width / Math.min(width, height),
      visible, shape: camera?.shape ?? style.shape, mirror: camera?.mirror ?? style.mirror };
  }
  return segment;
}

/** An overlapping edit is rejected as a no-op; neighboring work is never overwritten. */
export function upsertCompositionSegment(segments: CompositionSegment[] | undefined, segment: CompositionSegment, duration: number): CompositionSegment[] {
  const existing = segments ?? [];
  if (!validCompositionDraft(segment) || !validRange(segment, duration) || existing.some((item) => item.id !== segment.id
    && segment.start < item.end && segment.end > item.start)) return existing;
  return [...existing.filter((item) => item.id !== segment.id), clone(segment)].sort((a, b) => a.start - b.start);
}

export function updateCompositionSegment(segments: CompositionSegment[] | undefined, id: string, patch: CompositionPatch, duration: number): CompositionSegment[] {
  const existing = segments ?? [], segment = existing.find((item) => item.id === id);
  if (!segment) return existing;
  const updated = { ...segment, ...patch, id,
    ...(patch.camera ? { camera: { ...segment.camera, ...patch.camera } } : {}) };
  return upsertCompositionSegment(existing, updated, duration);
}

export function splitCompositionSegment(segments: CompositionSegment[] | undefined, id: string, time: number, newId: string = crypto.randomUUID()): CompositionSegment[] {
  const existing = segments ?? [], segment = existing.find((item) => item.id === id);
  if (!segment || !Number.isFinite(time) || time <= segment.start || time >= segment.end
    || !newId || existing.some((item) => item.id === newId)) return existing;
  return existing.flatMap((item) => item.id === id
    ? [{ ...clone(item), end: time }, { ...clone(item), id: newId, start: time }] : [item]);
}

export function removeCompositionSegment(segments: CompositionSegment[] | undefined, id: string): CompositionSegment[] {
  const existing = segments ?? [];
  return existing.some((item) => item.id === id) ? existing.filter((item) => item.id !== id) : existing;
}
