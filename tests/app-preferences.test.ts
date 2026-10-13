import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import { APP_PREFERENCES_KEY, APP_PREFERENCE_FIELD_PREFIX, readAppPreferences, updateAppPreferences } from '../src/services/app-preferences';
import { readRecordingDevicePreference, saveRecordingDevicePreference } from '../src/services/recording-device-preferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test('first run enables camera and microphone without storing transient runtime state', () => {
  const storage = memoryStorage(), preferences = readAppPreferences(storage);
  assert.equal(preferences.recording.cameraEnabled, true);
  assert.equal(preferences.recording.microphoneEnabled, true);
  assert.equal(preferences.recording.systemAudio, true);
  assert.equal(preferences.recording.inputRecording, true);
  assert.equal(preferences.recording.fps, 30);
  assert.equal(preferences.recording.mode, 'screen');
  assert.deepEqual(preferences.editor, { inspectorTab: 'canvas', libraryCollapsed: null, timelineScale: 1 });
  assert.equal(storage.values.size, 0, 'Reading must not mutate storage');
});

test('explicit off settings survive later changes and subsequent reads', () => {
  const storage = memoryStorage();
  updateAppPreferences({ recording: { cameraEnabled: false, microphoneEnabled: false, systemAudio: false, inputRecording: false, fps: 60 } }, storage);
  updateAppPreferences({ editor: { inspectorTab: 'audio', timelineScale: 4.5 } }, storage);
  const saved = readAppPreferences(storage);
  assert.equal(saved.recording.cameraEnabled, false); assert.equal(saved.recording.microphoneEnabled, false);
  assert.equal(saved.recording.systemAudio, false); assert.equal(saved.recording.fps, 60);
  assert.equal(saved.recording.inputRecording, false);
  assert.deepEqual(saved.editor, { inspectorTab: 'audio', libraryCollapsed: null, timelineScale: 4.5 });
});

test('independent effects, recording and editor patches merge rather than overwrite', () => {
  const storage = memoryStorage();
  updateAppPreferences({ recording: { cameraEffects: { filter: 'mono', smoothing: .7 } }, editor: { libraryCollapsed: false } }, storage);
  updateAppPreferences({ recording: { cameraEffects: { intensity: 1 } } }, storage);
  updateAppPreferences({ recording: { microphoneEnabled: false } }, storage);
  const saved = readAppPreferences(storage);
  assert.deepEqual(saved.recording.cameraEffects, { ...DEFAULT_CAMERA_EFFECTS, smoothing: .7, filter: 'mono', intensity: 1 });
  assert.equal(saved.recording.microphoneEnabled, false); assert.equal(saved.editor.libraryCollapsed, false);
  updateAppPreferences({ editor: { libraryCollapsed: null } }, storage);
  assert.equal(readAppPreferences(storage).editor.libraryCollapsed, null);
});

test('invalid fields are ignored independently while valid siblings survive', () => {
  const storage = memoryStorage();
  storage.setItem(APP_PREFERENCES_KEY, JSON.stringify({ version: 1,
    recording: { cameraEnabled: false, microphoneEnabled: 'false', systemAudio: false, fps: 59, mode: 'bad',
      screenSourceId: 'window:42', cameraEffects: { filter: 'warm', brightness: 99, intensity: .6, enabled: 'no' },
      countdown: 3, loading: true, error: 'failed' },
    editor: { inspectorTab: 'audio', libraryCollapsed: 'false', timelineScale: 8, exportPath: 'anything' }, unexpected: true }));
  const saved = readAppPreferences(storage);
  assert.equal(saved.recording.cameraEnabled, false); assert.equal(saved.recording.microphoneEnabled, true);
  assert.equal(saved.recording.systemAudio, false); assert.equal(saved.recording.fps, 30); assert.equal(saved.recording.mode, 'screen');
  assert.equal(saved.recording.screenSourceId, '');
  assert.deepEqual(saved.recording.cameraEffects, { ...DEFAULT_CAMERA_EFFECTS, filter: 'warm', intensity: .6 });
  assert.deepEqual(saved.editor, { inspectorTab: 'audio', libraryCollapsed: null, timelineScale: 1 });
  assert.ok(!('loading' in saved.recording)); assert.ok(!('countdown' in saved.recording)); assert.ok(!('error' in saved.recording));
  assert.ok(!('unexpected' in saved)); assert.ok(!('exportPath' in saved.editor));
});

test('region remembers its display association while window handles are never persisted', () => {
  const storage = memoryStorage(), crop = { x: 100, y: 80, width: 1280, height: 720 };
  updateAppPreferences({ recording: { mode: 'region', screenSourceId: 'screen:display-2', region: { sourceId: 'screen:display-2', crop } } }, storage);
  updateAppPreferences({ recording: { mode: 'window' } }, storage);
  const saved = readAppPreferences(storage);
  assert.equal(saved.recording.mode, 'window'); assert.equal(saved.recording.screenSourceId, 'screen:display-2');
  assert.deepEqual(saved.recording.region, { sourceId: 'screen:display-2', crop });
  assert.ok(!('windowSourceId' in saved.recording));
  const invalidStorage = memoryStorage();
  invalidStorage.setItem(APP_PREFERENCES_KEY, JSON.stringify({ version: 1, recording: { region: { sourceId: 'window:99', crop } } }));
  assert.equal(readAppPreferences(invalidStorage).recording.region, null);
});

test('invalid region coordinates cannot replace the previous valid association', () => {
  const storage = memoryStorage(), region = { sourceId: 'screen:1', crop: { x: 10, y: 20, width: 600, height: 400 } };
  updateAppPreferences({ recording: { region } }, storage);
  for (const crop of [{ x: -1, y: 0, width: 200, height: 200 }, { x: 1.5, y: 0, width: 200, height: 200 }, { x: 0, y: 0, width: 1, height: 200 }]) {
    updateAppPreferences({ recording: { region: { sourceId: 'screen:2', crop } } }, storage);
    assert.deepEqual(readAppPreferences(storage).recording.region, region);
  }
  updateAppPreferences({ recording: { region: null } }, storage);
  assert.equal(readAppPreferences(storage).recording.region, null);
});

test('legacy effects remain readable, updated fields take precedence, and saved device IDs stay compatible', () => {
  const storage = memoryStorage(), effects = { enabled: false, smoothing: .6, brightness: .2, filter: 'cool', intensity: .8 };
  storage.setItem('frameflow.cameraEffects.v1', JSON.stringify(effects));
  saveRecordingDevicePreference('camera', 'camera-exact-id', storage);
  saveRecordingDevicePreference('microphone', 'DJI', storage);
  assert.deepEqual(readAppPreferences(storage).recording.cameraEffects, effects);
  updateAppPreferences({ recording: { fps: 60, cameraEffects: { filter: 'mono' } } }, storage);
  storage.setItem('frameflow.cameraEffects.v1', JSON.stringify({ ...effects, filter: 'warm' }));
  assert.deepEqual(readAppPreferences(storage).recording.cameraEffects, { ...effects, filter: 'mono' }, 'Versioned fields take precedence over old effects');
  assert.equal(readRecordingDevicePreference('camera', storage), 'camera-exact-id');
  assert.equal(readRecordingDevicePreference('microphone', storage), 'DJI');
});

test('v1 settings remain readable without rewriting unrelated fields during migration', () => {
  const storage = memoryStorage();
  const old = JSON.stringify({ version: 1, recording: { microphoneEnabled: false, fps: 60 }, editor: { libraryCollapsed: true } });
  storage.setItem(APP_PREFERENCES_KEY, old);
  updateAppPreferences({ recording: { cameraEnabled: false } }, storage);
  assert.equal(storage.getItem(APP_PREFERENCES_KEY), old);
  assert.deepEqual([...storage.values.keys()].sort(), [APP_PREFERENCES_KEY, APP_PREFERENCE_FIELD_PREFIX + 'recording.cameraEnabled'].sort());
  const result = readAppPreferences(storage);
  assert.equal(result.recording.cameraEnabled, false); assert.equal(result.recording.microphoneEnabled, false);
  assert.equal(result.recording.fps, 60); assert.equal(result.editor.libraryCollapsed, true);
});

test('interleaved renderer updates preserve camera switches, individual effects and editor settings', () => {
  const storage = memoryStorage();
  let interleaved = false;
  const launcherStorage = { getItem: storage.getItem, setItem: (key: string, value: string) => {
    if (!interleaved) {
      interleaved = true;
      updateAppPreferences({ recording: { cameraEffects: { filter: 'mono', intensity: .9 } }, editor: { inspectorTab: 'audio' } }, storage);
    }
    storage.setItem(key, value);
  } };
  updateAppPreferences({ recording: { cameraEnabled: false, microphoneEnabled: false } }, launcherStorage);
  const result = readAppPreferences(storage);
  assert.equal(result.recording.cameraEnabled, false); assert.equal(result.recording.microphoneEnabled, false);
  assert.equal(result.recording.cameraEffects.filter, 'mono'); assert.equal(result.recording.cameraEffects.intensity, .9);
  assert.equal(result.editor.inspectorTab, 'audio');
  assert.equal(storage.values.size, 5, 'Each patch writes only its explicitly supplied valid fields');
});

test('invalid leaf values neither write a stale fallback nor discard valid saved siblings', () => {
  const storage = memoryStorage();
  updateAppPreferences({ recording: { cameraEffects: { smoothing: .8, filter: 'cool' } } }, storage);
  const keys = [...storage.values.keys()];
  updateAppPreferences({ recording: { cameraEffects: { smoothing: 4 } } }, storage);
  assert.deepEqual([...storage.values.keys()], keys);
  storage.setItem(APP_PREFERENCE_FIELD_PREFIX + 'recording.cameraEnabled', 'not-json');
  assert.equal(readAppPreferences(storage).recording.cameraEnabled, true);
  assert.equal(readAppPreferences(storage).recording.cameraEffects.smoothing, .8);
  assert.equal(readAppPreferences(storage).recording.cameraEffects.filter, 'cool');
});

test('malformed, unsupported and unavailable storage safely returns defaults', () => {
  const storage = memoryStorage();
  for (const raw of ['{', 'null', '[]', 'true', '42', '{"version":2,"recording":{"cameraEnabled":false}}']) {
    storage.setItem(APP_PREFERENCES_KEY, raw);
    assert.equal(readAppPreferences(storage).recording.cameraEnabled, true);
  }
  const denied = { getItem: () => { throw new Error('Access denied'); }, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.equal(readAppPreferences(denied).recording.microphoneEnabled, true);
  assert.doesNotThrow(() => updateAppPreferences({ recording: { microphoneEnabled: false } }, denied));
  assert.equal(updateAppPreferences({ recording: { cameraEnabled: false } }, denied).recording.cameraEnabled, false);
});

test('every read returns independent objects and editor scale follows the 1 through 6 UI range', () => {
  const storage = memoryStorage(), first = readAppPreferences(storage);
  first.recording.cameraEffects.enabled = false; first.editor.inspectorTab = 'zoom';
  assert.equal(readAppPreferences(storage).recording.cameraEffects.enabled, true);
  assert.equal(readAppPreferences(storage).editor.inspectorTab, 'canvas');
  updateAppPreferences({ editor: { timelineScale: 6 } }, storage);
  assert.equal(readAppPreferences(storage).editor.timelineScale, 6);
  updateAppPreferences({ editor: { timelineScale: .5 } }, storage);
  assert.equal(readAppPreferences(storage).editor.timelineScale, 6);
});
