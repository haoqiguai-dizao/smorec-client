import assert from 'node:assert/strict';
import test from 'node:test';
import { BEAUTY_FIELDS, BEAUTY_ZERO, SIGNED_BEAUTY_FIELDS } from '../shared/beauty';
import { DEFAULT_CAMERA_EFFECTS, cameraBeautyPreset, cameraEffectsAt } from '../shared/camera-effects';
import { parseCameraEffects, parseCameraEffectsPatch, parseProject } from '../electron/services/validation';
import { readAppPreferences, updateAppPreferences } from '../src/services/app-preferences';
import { DEFAULT_STYLE } from '../shared/constants';
import { faceGeometry, polygonMask, warpPoint } from '../src/services/camera-effects/face/geometry';
import type { CameraEffects, Project } from '../shared/types';

test('all facial controls persist through preferences, project validation and recorded source-time changes', () => {
  const values = new Map<string, string>(), storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const effects: CameraEffects = { ...DEFAULT_CAMERA_EFFECTS };
  for (const field of BEAUTY_FIELDS) effects[field] = SIGNED_BEAUTY_FIELDS.includes(field) ? -0.42 : 0.63;
  updateAppPreferences({ recording: { cameraEffects: effects } }, storage);
  assert.deepEqual(readAppPreferences(storage).recording.cameraEffects, effects);
  assert.deepEqual(parseCameraEffects(effects), effects);
  const project: Project = { id: 'd92c2b07-c9e0-41b0-93a6-c15c897f530b', name: 'Beauty', createdAt: new Date().toISOString(),
    duration: 3, width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' },
    clips: [{ id: 'clip', start: 0, end: 3 }], cursor: [], zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 },
    camera: { enabled: true, offset: 0, position: 'bottom-right', size: 0.22, mirror: true, shape: 'circle', shrinkOnZoom: false,
      effects, effectKeyframes: [{ t: 0, effects: DEFAULT_CAMERA_EFFECTS }, { t: 1, effects }], useRecordedEffects: true } };
  const reopened = parseProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(reopened.camera?.effects, effects);
  assert.deepEqual(cameraEffectsAt(reopened.camera!, 1.5), effects);
  assert.deepEqual(cameraEffectsAt(reopened.camera!, 0.5), DEFAULT_CAMERA_EFFECTS);
  assert.equal(cameraBeautyPreset({ ...DEFAULT_CAMERA_EFFECTS, faceSlim: 0.1 }), undefined);
  assert.equal(cameraBeautyPreset({ ...DEFAULT_CAMERA_EFFECTS, ...BEAUTY_ZERO }), 'natural');
});

test('facial IPC patches reject invalid values while signed controls accept both directions', () => {
  for (const field of BEAUTY_FIELDS) {
    assert.deepEqual(parseCameraEffectsPatch({ [field]: 0.5 }), { [field]: 0.5 });
    for (const invalid of [NaN, Infinity, -1.01, 1.01, '0.5', null, undefined]) assert.throws(() => parseCameraEffectsPatch({ [field]: invalid }));
    if (SIGNED_BEAUTY_FIELDS.includes(field)) assert.deepEqual(parseCameraEffectsPatch({ [field]: -0.8 }), { [field]: -0.8 });
    else assert.throws(() => parseCameraEffectsPatch({ [field]: -0.1 }));
  }
});

test('local warp is identity outside support and remains monotonic at strongest supported eye magnification', () => {
  const output = new Float64Array(2), warps = [{ center: { x: 0.5, y: 0.5 }, radius: 0.2, zoom: 0.2, dx: 0, dy: 0 }];
  warpPoint(0, 0, warps, output); assert.deepEqual([...output], [0, 0]);
  let previous = -Infinity;
  for (let i = 0; i <= 200; i++) {
    warpPoint(i / 200, 0.5, warps, output);
    assert.ok(output[0] > previous, 'No folded pixels across the eye'); previous = output[0];
  }
  const polygon = [{ x: 0.2, y: 0.4 }, { x: 0.8, y: 0.4 }, { x: 0.8, y: 0.6 }, { x: 0.2, y: 0.6 }];
  assert.equal(polygonMask(0.5, 0.5, polygon, 0.01), 1);
  assert.equal(polygonMask(0.5, 0.39, polygon, 0.01), 0, 'No whitening outside mouth');
  assert.equal(polygonMask(0.5, 0.4, polygon, 0.01), 0, 'Protect lip boundary');
  assert.equal(faceGeometry([], 1, DEFAULT_CAMERA_EFFECTS), undefined);
  assert.equal(faceGeometry(Array.from({ length: 478 }, () => ({ x: NaN, y: 0 })), 1, DEFAULT_CAMERA_EFFECTS), undefined);
});
