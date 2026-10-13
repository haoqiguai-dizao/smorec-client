import type { CanvasStyle, Project, WebcamStyle } from '../../shared/types';
import type { PresenterAspect } from '../../shared/presenter';
import type { DesktopPreferenceData, DesktopPreferencePatch } from './desktop-preferences';

const styleFields = ['background', 'padding', 'radius', 'shadow', 'aspect', 'cursorScale', 'smoothing',
  'showCursor', 'clickHighlight'] as const satisfies readonly (keyof CanvasStyle)[];

function changedFields<T extends object>(before: T, after: T, fields: readonly (keyof T)[]): Partial<T> {
  const changed: Partial<T> = {};
  for (const field of fields) if (before[field] !== after[field]) changed[field] = after[field];
  return changed;
}

function cameraCenter(camera: WebcamStyle): { x: number; y: number } {
  return camera.placement ?? {
    x: camera.position.endsWith('left') ? .15 : .85,
    y: camera.position.startsWith('top') ? .2 : .8,
  };
}

/** Inputs have already passed project validation. Unchanged old fields never become defaults. */
export function projectPreferenceChanges(previous: Project, next: Project): DesktopPreferencePatch {
  const patch: DesktopPreferencePatch = {};
  const style = changedFields(previous.style, next.style, styleFields);
  const audio = changedFields(previous.audio, next.audio, ['system', 'microphone']);
  if (Object.keys(style).length) patch.style = style;
  if (Object.keys(audio).length) patch.audio = audio;
  const before = previous.camera, after = next.camera;
  if (!before || !after) return patch;
  if (before.shrinkOnZoom !== after.shrinkOnZoom) patch.cameraShrinkOnZoom = after.shrinkOnZoom;
  const recordedMode = after.useRecordedMode !== false && Boolean(after.modeKeyframes?.length);
  if (!recordedMode && (before.mode ?? 'overlay') !== (after.mode ?? 'overlay')) patch.cameraMode = after.mode ?? 'overlay';
  // A recorded keyframe track remains the layout authority until the user opts out.
  const recordedLayout = after.useRecordedLayout !== false && Boolean(after.keyframes?.length);
  if (!recordedLayout) {
    const layout = changedFields(before, after, ['size', 'shape', 'mirror', 'zoom']);
    const center = changedFields(cameraCenter(before), cameraCenter(after), ['x', 'y']);
    const camera = { ...layout, ...center };
    if (Object.keys(camera).length) patch.camera = camera;
  }
  if (after.useRecordedMirror === false && (before.useRecordedMirror !== false || before.mirror !== after.mirror)) {
    patch.camera = { ...patch.camera, mirror: after.mirror };
  }
  return patch;
}

/** New recordings inherit user defaults; recorded layout/effect tracks are added by ProjectStore. */
export function newRecordingCameraStyle(preferences: DesktopPreferenceData, offset: number): WebcamStyle {
  return { offset, enabled: true, position: 'bottom-right',
    ...(preferences.camera.zoom === undefined ? {} : { zoom: preferences.camera.zoom }),
    size: preferences.camera.size, shape: preferences.camera.shape, mirror: preferences.camera.mirror,
    placement: { x: preferences.camera.x, y: preferences.camera.y }, shrinkOnZoom: preferences.cameraShrinkOnZoom };
}

/** Existing projects never call this: their saved canvas remains the source of truth. */
export function newProjectCanvasStyle(preferences: Pick<DesktopPreferenceData, 'style'>,
  options: { presenter?: boolean; presenterAspect?: PresenterAspect; imported?: boolean } = {}): CanvasStyle {
  return { ...preferences.style, ...(options.presenter ? { aspect: options.presenterAspect ?? '16:9' } : {}),
    ...(options.imported ? { showCursor: false } : {}) };
}
