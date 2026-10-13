import { CAMERA_FILTERS, DEFAULT_CAMERA_EFFECTS } from '../../shared/camera-effects';
import { BEAUTY_FIELDS, SIGNED_BEAUTY_FIELDS } from '../../shared/beauty';
import type { CameraEffects, Rect } from '../../shared/types';
import { RECORDING_RESOLUTIONS, type RecordingResolution } from '../../shared/recording';

export interface RecordingPreferences {
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  systemAudio: boolean;
  inputRecording: boolean;
  inputRecordingConfirmed: boolean;
  fps: 30 | 60;
  resolution: RecordingResolution;
  mode: 'screen' | 'window' | 'region';
  cameraEffects: CameraEffects;
  screenSourceId: string;
  region: { sourceId: string; crop: Rect } | null;
}
export interface EditorPreferences {
  inspectorTab: 'canvas' | 'camera' | 'cursor' | 'audio' | 'zoom';
  libraryCollapsed: boolean | null;
  timelineScale: number;
}
export interface AppPreferences { recording: RecordingPreferences; editor: EditorPreferences }
export interface AppPreferencesPatch {
  recording?: Partial<Omit<RecordingPreferences, 'cameraEffects'>> & { cameraEffects?: Partial<CameraEffects> };
  editor?: Partial<EditorPreferences>;
}
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type UnknownObject = Record<string, unknown>;
export const APP_PREFERENCES_KEY = 'frameflow.appPreferences.v1';
export const APP_PREFERENCE_FIELD_PREFIX = 'frameflow.appPreferences.v2.';
const LEGACY_CAMERA_EFFECTS_KEY = 'frameflow.cameraEffects.v1';

function object(value: unknown): UnknownObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownObject : {};
}
function defaults(): AppPreferences {
  return {
    recording: { cameraEnabled: true, microphoneEnabled: true, systemAudio: true, inputRecording: true, inputRecordingConfirmed: false, fps: 30, resolution: '1440p', mode: 'screen',
      cameraEffects: { ...DEFAULT_CAMERA_EFFECTS }, screenSourceId: '', region: null },
    editor: { inspectorTab: 'canvas', libraryCollapsed: null, timelineScale: 1 },
  };
}
function numberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function screenId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4096 && (value === '' || value.startsWith('screen:'))
    && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}
function cameraEffects(value: unknown, previous: CameraEffects): CameraEffects {
  const next = object(value), result = { ...previous };
  if (typeof next.enabled === 'boolean') result.enabled = next.enabled;
  if (CAMERA_FILTERS.some(filter => filter.id === next.filter)) result.filter = next.filter as CameraEffects['filter'];
  for (const field of ['smoothing', 'brightness', 'intensity'] as const) {
    if (numberInRange(next[field], 0, 1)) result[field] = next[field];
  }
  for (const field of BEAUTY_FIELDS) {
    if (numberInRange(next[field], SIGNED_BEAUTY_FIELDS.includes(field) ? -1 : 0, 1)) result[field] = next[field];
  }
  return result;
}
function recordingRegion(value: unknown, previous: RecordingPreferences['region']): RecordingPreferences['region'] {
  if (value === null) return null;
  const next = object(value), crop = object(next.crop);
  if (!screenId(next.sourceId) || !next.sourceId) return previous;
  if (!['x', 'y', 'width', 'height'].every(field => numberInRange(crop[field], 0, 1_000_000) && Number.isInteger(crop[field]))) return previous;
  if ((crop.width as number) < 32 || (crop.height as number) < 32) return previous;
  return { sourceId: next.sourceId, crop: { x: crop.x as number, y: crop.y as number, width: crop.width as number, height: crop.height as number } };
}
function mergePreferences(previous: AppPreferences, patch: unknown): AppPreferences {
  const value = object(patch), recording = object(value.recording), editor = object(value.editor);
  const result: AppPreferences = { recording: { ...previous.recording, cameraEffects: { ...previous.recording.cameraEffects },
    region: previous.recording.region ? { ...previous.recording.region, crop: { ...previous.recording.region.crop } } : null }, editor: { ...previous.editor } };
  for (const field of ['cameraEnabled', 'microphoneEnabled', 'systemAudio', 'inputRecording', 'inputRecordingConfirmed'] as const) {
    if (typeof recording[field] === 'boolean') result.recording[field] = recording[field];
  }
  if (recording.fps === 30 || recording.fps === 60) result.recording.fps = recording.fps;
  if (RECORDING_RESOLUTIONS.includes(recording.resolution as RecordingResolution)) result.recording.resolution = recording.resolution as RecordingResolution;
  if (recording.mode === 'screen' || recording.mode === 'window' || recording.mode === 'region') result.recording.mode = recording.mode;
  if (screenId(recording.screenSourceId)) result.recording.screenSourceId = recording.screenSourceId;
  result.recording.cameraEffects = cameraEffects(recording.cameraEffects, result.recording.cameraEffects);
  result.recording.region = recordingRegion(recording.region, result.recording.region);
  if (['canvas', 'camera', 'cursor', 'audio', 'zoom'].includes(editor.inspectorTab as string)) result.editor.inspectorTab = editor.inspectorTab as EditorPreferences['inspectorTab'];
  if (typeof editor.libraryCollapsed === 'boolean' || editor.libraryCollapsed === null) result.editor.libraryCollapsed = editor.libraryCollapsed;
  if (numberInRange(editor.timelineScale, 1, 6)) result.editor.timelineScale = editor.timelineScale;
  return result;
}
function storedValue(key: string, storage?: PreferenceStorage): unknown {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  }
  catch { return undefined; }
}
const booleanValue = (value: unknown) => typeof value === 'boolean' ? value : undefined;
const unitValue = (value: unknown) => numberInRange(value, 0, 1) ? value : undefined;
const fields: Record<string, (value: unknown) => unknown> = {
  ...Object.fromEntries(BEAUTY_FIELDS.map(field => ['recording.cameraEffects.' + field,
    (value: unknown) => numberInRange(value, SIGNED_BEAUTY_FIELDS.includes(field) ? -1 : 0, 1) ? value : undefined])),
  'recording.cameraEnabled': booleanValue,
  'recording.microphoneEnabled': booleanValue,
  'recording.systemAudio': booleanValue,
  'recording.inputRecording': booleanValue,
  'recording.inputRecordingConfirmed': booleanValue,
  'recording.fps': value => value === 30 || value === 60 ? value : undefined,
  'recording.resolution': value => RECORDING_RESOLUTIONS.includes(value as RecordingResolution) ? value : undefined,
  'recording.mode': value => value === 'screen' || value === 'window' || value === 'region' ? value : undefined,
  'recording.screenSourceId': value => screenId(value) ? value : undefined,
  'recording.region': value => value === null ? null : recordingRegion(value, null) ?? undefined,
  'recording.cameraEffects.enabled': booleanValue,
  'recording.cameraEffects.smoothing': unitValue,
  'recording.cameraEffects.brightness': unitValue,
  'recording.cameraEffects.intensity': unitValue,
  'recording.cameraEffects.filter': value => CAMERA_FILTERS.some(filter => filter.id === value) ? value : undefined,
  'editor.inspectorTab': value => ['canvas', 'camera', 'cursor', 'audio', 'zoom'].includes(value as string) ? value : undefined,
  'editor.libraryCollapsed': value => value === null ? null : booleanValue(value),
  'editor.timelineScale': value => numberInRange(value, 1, 6) ? value : undefined,
};
function fieldValue(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    const record = object(current);
    return Object.hasOwn(record, key) ? record[key] : undefined;
  }, value);
}
function assignField(preferences: AppPreferences, path: string, value: unknown): void {
  const parts = path.split('.'), name = parts.pop()!;
  let target = object(preferences);
  for (const part of parts) target = object(target[part]);
  target[name] = value;
}

/** Read known fields independently; damaged values do not discard valid sibling settings. */
export function readAppPreferences(storage?: PreferenceStorage): AppPreferences {
  const initial = defaults();
  initial.recording.cameraEffects = cameraEffects(storedValue(LEGACY_CAMERA_EFFECTS_KEY, storage), initial.recording.cameraEffects);
  const stored = object(storedValue(APP_PREFERENCES_KEY, storage));
  const preferences = stored.version === 1 ? mergePreferences(initial, stored) : initial;
  for (const [path, normalize] of Object.entries(fields)) {
    const value = normalize(storedValue(APP_PREFERENCE_FIELD_PREFIX + path, storage));
    if (value !== undefined) assignField(preferences, path, value);
  }
  return preferences;
}

/** Separate leaf keys prevent different renderers from overwriting unrelated settings. */
export function updateAppPreferences(patch: AppPreferencesPatch, storage?: PreferenceStorage): AppPreferences {
  for (const [path, normalize] of Object.entries(fields)) {
    const value = normalize(fieldValue(patch, path));
    if (value === undefined) continue;
    try { (storage ?? globalThis.localStorage).setItem(APP_PREFERENCE_FIELD_PREFIX + path, JSON.stringify(value)); }
    catch { /* Preferences are optional when storage is full or unavailable. */ }
  }
  return mergePreferences(readAppPreferences(storage), patch);
}
