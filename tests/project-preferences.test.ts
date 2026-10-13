import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_STYLE } from '../shared/constants';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import { microphonePreset } from '../shared/microphone-effects';
import type { Project } from '../shared/types';
import { DesktopPreferences } from '../electron/services/desktop-preferences';
import { newRecordingCameraStyle, projectPreferenceChanges } from '../electron/services/project-preferences';

function oldProject(): Project {
  return { id: 'old-project', name: 'Old project', createdAt: '2026-09-01T00:00:00Z', duration: 5,
    width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' },
    cursor: [], clips: [{ id: 'clip', start: 0, end: 5 }], zooms: [], style: { ...DEFAULT_STYLE },
    audio: { system: 1, microphone: 1 }, camera: { offset: .5, enabled: true, size: .22, shape: 'circle',
      position: 'bottom-right', mirror: true, shrinkOnZoom: false, useRecordedLayout: false,
      effects: { ...DEFAULT_CAMERA_EFFECTS } } };
}

test('post-edit microphone effects never replace recording device defaults', () => {
  const before = oldProject(), after = structuredClone(before);
  after.audio.microphoneEffects = microphonePreset('warm');
  assert.deepEqual(projectPreferenceChanges(before, after), {});
  after.audio.microphone = .7;
  assert.deepEqual(projectPreferenceChanges(before, after), { audio: { microphone: .7 } });
  assert.equal(before.audio.microphoneEffects, undefined, 'Opening an old project keeps its original sound');
});

test('opening, renaming, cutting or saving an unchanged old project has no default-setting changes', () => {
  const before = oldProject(), after = structuredClone(before);
  assert.deepEqual(projectPreferenceChanges(before, after), {});
  after.name = 'Renamed'; after.clips = [{ id: 'trimmed', start: .25, end: 4.75 }];
  assert.deepEqual(projectPreferenceChanges(before, after), {});
});

test('style and audio changes contain only the modified fields', () => {
  const before = oldProject(), snapshot = structuredClone(before), after = structuredClone(before);
  after.style.padding = 96; after.audio.microphone = .6;
  assert.deepEqual(projectPreferenceChanges(before, after), { style: { padding: 96 }, audio: { microphone: .6 } });
  assert.deepEqual(before, snapshot, 'Comparison must not mutate the old project');
  after.style.showCursor = false; after.style.aspect = '1:1';
  assert.deepEqual(projectPreferenceChanges(before, after).style, { padding: 96, aspect: '1:1', showCursor: false });
});

test('camera effects, visibility, synchronization and keyframes do not replace global layout', () => {
  const before = oldProject(), after = structuredClone(before);
  Object.assign(after.camera!, { offset: 2, enabled: false, useRecordedEffects: false,
    effects: { ...DEFAULT_CAMERA_EFFECTS, filter: 'mono' },
    keyframes: [{ t: 0, x: .2, y: .3, size: .4, shape: 'rounded', mirror: false, visible: false }] });
  assert.deepEqual(projectPreferenceChanges(before, after), {});
  after.camera!.shrinkOnZoom = true;
  assert.deepEqual(projectPreferenceChanges(before, after), { cameraShrinkOnZoom: true });
});

test('manual camera layout changes persist only changed scalar fields and effective center axes', () => {
  const before = oldProject(), after = structuredClone(before);
  before.camera!.placement = { x: .3, y: .7 };
  after.camera!.placement = { x: .3, y: .4 }; after.camera!.shape = 'rounded';
  assert.deepEqual(projectPreferenceChanges(before, after), { camera: { shape: 'rounded', y: .4 } });
  after.camera!.position = 'top-left';
  assert.deepEqual(projectPreferenceChanges(before, after), { camera: { shape: 'rounded', y: .4 } },
    'An explicit placement remains authoritative over an inactive corner setting');
  after.camera!.size = .31; after.camera!.mirror = false;
  assert.deepEqual(projectPreferenceChanges(before, after), { camera: { size: .31, shape: 'rounded', mirror: false, y: .4 } });
  const cornerBefore = oldProject(), cornerAfter = structuredClone(cornerBefore);
  cornerAfter.camera!.position = 'top-left';
  assert.deepEqual(projectPreferenceChanges(cornerBefore, cornerAfter), { camera: { x: .15, y: .2 } });
  cornerAfter.camera!.position = 'bottom-right'; cornerAfter.camera!.placement = { x: .85, y: .8 };
  assert.deepEqual(projectPreferenceChanges(cornerBefore, cornerAfter), {}, 'Equivalent coordinates are not a layout change');
});

test('active recorded camera layout cannot leak static base fields into future recordings', () => {
  const before = oldProject(), after = structuredClone(before);
  after.camera!.useRecordedLayout = true;
  after.camera!.keyframes = [{ t: 0, x: .3, y: .4, size: .3, shape: 'rounded', mirror: true, visible: true }];
  after.camera!.size = .4; after.camera!.mirror = false; after.camera!.position = 'top-left';
  after.camera!.shrinkOnZoom = true;
  assert.deepEqual(projectPreferenceChanges(before, after), { cameraShrinkOnZoom: true });
});

test('independent mirror preference does not replace recorded geometry defaults', () => {
  const before = oldProject();
  Object.assign(before.camera!, { useRecordedLayout: true,
    keyframes: [{ t: 0, x: .3, y: .4, size: .2, shape: 'circle', mirror: true, visible: true }] });
  const after = structuredClone(before);
  Object.assign(after.camera!, { mirror: false, useRecordedMirror: false });
  assert.deepEqual(projectPreferenceChanges(before, after), { camera: { mirror: false } });
});

test('only deliberate static camera mode changes update the remembered recording mode', () => {
  const before = oldProject(), after = structuredClone(before);
  after.camera!.mode = 'overlay';
  assert.deepEqual(projectPreferenceChanges(before, after), {}, 'Missing legacy mode is already overlay');
  after.camera!.mode = 'presenter'; after.camera!.useRecordedMode = false;
  assert.deepEqual(projectPreferenceChanges(before, after), { cameraMode: 'presenter' });
  after.camera!.modeKeyframes = [{ t: 0, mode: 'presenter' }, { t: 2, mode: 'overlay' }];
  after.camera!.useRecordedMode = true;
  assert.deepEqual(projectPreferenceChanges(before, after), {}, 'Recorded scene changes cannot replace global preferences');
  const presenter = structuredClone(before); presenter.camera!.mode = 'presenter';
  after.camera!.mode = 'overlay'; after.camera!.useRecordedMode = false;
  assert.deepEqual(projectPreferenceChanges(presenter, after), { cameraMode: 'overlay' });
});

test('field changes survive reconstructed preference stores without overwriting newer defaults', async () => {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'project-preferences-'));
  const stores: DesktopPreferences[] = [];
  const open = () => { const store = new DesktopPreferences(() => directory); stores.push(store); return store; };
  try {
    const current = open();
    current.update({ style: { background: 'paper', padding: 112, radius: 42 }, audio: { system: .4, microphone: .5 },
      camera: { x: .33, y: .44, size: .35, mirror: false, shape: 'rounded' }, cameraShrinkOnZoom: true });
    current.flush();
    const before = oldProject(), effectEdit = structuredClone(before);
    effectEdit.camera!.effects = { ...DEFAULT_CAMERA_EFFECTS, filter: 'warm', intensity: .8 };
    assert.deepEqual(projectPreferenceChanges(before, effectEdit), {});
    const edited = structuredClone(effectEdit); edited.style.padding = 80; edited.audio.microphone = .7;
    const second = open(); second.update(projectPreferenceChanges(effectEdit, edited)); second.flush();
    const saved = open().read();
    assert.equal(saved.style.padding, 80); assert.equal(saved.style.background, 'paper'); assert.equal(saved.style.radius, 42);
    assert.deepEqual(saved.audio, { system: .4, microphone: .7 });
    assert.deepEqual(saved.camera, { x: .33, y: .44, size: .35, mirror: false, shape: 'rounded', visible: true });
    assert.equal(saved.cameraShrinkOnZoom, true);
    const camera = newRecordingCameraStyle(saved, .625);
    assert.deepEqual(camera, { offset: .625, enabled: true, position: 'bottom-right', size: .35, shape: 'rounded',
      mirror: false, placement: { x: .33, y: .44 }, shrinkOnZoom: true });
    camera.placement!.x = 1;
    assert.equal(saved.camera.x, .33, 'A new project cannot mutate the stored placement by reference');
  } finally {
    for (const store of stores) store.flush();
    const resolved = await fs.realpath(directory), relative = path.relative(output, resolved);
    assert.ok(relative.startsWith('project-preferences-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
