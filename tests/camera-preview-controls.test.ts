import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import type { CameraEffects, RecordingOptions, RecordingState } from '../shared/types';
import { DesktopPreferences } from '../electron/services/desktop-preferences';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import type { NativeClient } from '../electron/services/native-client';

const firstId = 'f21aa43f-5d09-4cfe-ae30-0163fb085fc9';
const secondId = '80c3ff05-ccdb-420c-b38c-2adfb91ecf63';
const natural: CameraEffects = { ...DEFAULT_CAMERA_EFFECTS };
const mono: CameraEffects = { ...natural, filter: 'mono', intensity: 1 };
const options: RecordingOptions = { sourceId: 'screen:fixture', fps: 30, microphone: false,
  systemAudio: false, cameraSessionId: firstId, cameraEffects: mono };

function controller(preferences?: DesktopPreferences) {
  let state: RecordingState = { status: 'idle' }, changes = 0, nativeCalls = 0;
  const native = { request: async () => {
    nativeCalls++; throw new Error('Preview camera controls must never call native capture');
  } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => state, () => { changes++; }, preferences);
  return { controls, setStatus: (status: RecordingState['status']) => { state = { status }; },
    changes: () => changes, nativeCalls: () => nativeCalls };
}

async function preferencesFixture(run: (preferences: DesktopPreferences, reopen: () => DesktopPreferences) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'camera-preview-controls-'));
  const stores: DesktopPreferences[] = [];
  const reopen = () => { const store = new DesktopPreferences(() => directory); stores.push(store); return store; };
  try { await run(reopen(), reopen); }
  finally {
    for (const store of stores) store.flush();
    const resolved = await fs.realpath(directory), relative = path.relative(output, resolved);
    assert.ok(relative.startsWith('camera-preview-controls-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

test('idle and recovered-error preview use saved layout, detached effects and no recording timeline', async () => {
  await preferencesFixture(async preferences => {
    preferences.update({ camera: { x: .2, y: .3, shape: 'capsule', size: .34, mirror: false } });
    for (const status of ['idle', 'error'] as const) {
      const fixture = controller(preferences); fixture.setStatus(status);
      assert.equal(fixture.controls.snapshot().cameraPreviewing, false);
      const input = { ...natural }; fixture.controls.preparePreview(firstId, input);
      input.intensity = .97;
      const snapshot = fixture.controls.snapshot();
      assert.equal(snapshot.status, status); assert.equal(snapshot.cameraPreviewing, true);
      assert.equal(snapshot.cameraSessionId, firstId);
      assert.equal(snapshot.cameraAvailable, true); assert.equal(snapshot.cameraVisible, true);
      assert.equal(snapshot.cameraShape, 'capsule'); assert.equal(snapshot.cameraSize, .34);
      assert.equal(snapshot.cameraMirror, false); assert.deepEqual(snapshot.cameraEffects, natural);
      snapshot.cameraEffects!.brightness = .99;
      assert.deepEqual(fixture.controls.snapshot().cameraEffects, natural);
      assert.deepEqual(fixture.controls.keyframes(10), []);
      assert.deepEqual(fixture.controls.effectsKeyframes(10), []);
      assert.ok(fixture.changes() > 0, 'Preview readiness must publish a state update');
      assert.equal(fixture.nativeCalls(), 0);
    }
  });
});

test('same-session readiness updates effects without resetting edited layout; a new session reloads preferences', async () => {
  await preferencesFixture(async preferences => {
    const { controls, nativeCalls } = controller(preferences);
    controls.preparePreview(firstId, natural);
    await controls.control({ type: 'camera-shape', value: 'capsule' });
    await controls.control({ type: 'camera-size', value: .36 });
    await controls.control({ type: 'camera-mirror', value: false });
    controls.placement({ x: .25, y: .4 });
    // A duplicate ready/effects update must not reload a different saved layout mid-preview.
    preferences.update({ camera: { shape: 'landscape', size: .18, mirror: true, x: .7, y: .6 } });
    controls.preparePreview(firstId, mono);
    assert.equal(controls.snapshot().cameraShape, 'capsule');
    assert.equal(controls.snapshot().cameraSize, .36); assert.equal(controls.snapshot().cameraMirror, false);
    assert.deepEqual(controls.snapshot().cameraEffects, mono);
    controls.preparePreview(secondId, natural);
    const second = controls.snapshot();
    assert.equal(second.cameraSessionId, secondId); assert.equal(second.cameraPreviewing, true);
    assert.equal(second.cameraAvailable, true); assert.equal(second.cameraVisible, true);
    assert.equal(second.cameraShape, 'landscape'); assert.equal(second.cameraSize, .18);
    assert.equal(second.cameraMirror, true); assert.deepEqual(second.cameraEffects, natural);
    assert.deepEqual(controls.keyframes(10), []); assert.deepEqual(controls.effectsKeyframes(10), []);
    assert.equal(nativeCalls(), 0);
  });
});

test('late end from an old preview cannot hide its replacement; matching and unqualified ends release preview', async () => {
  const { controls, nativeCalls } = controller();
  controls.preparePreview(firstId, natural); controls.preparePreview(secondId, mono);
  const active = controls.snapshot(); controls.endPreview(firstId);
  assert.deepEqual(controls.snapshot(), active);
  controls.endPreview(secondId);
  assert.equal(controls.snapshot().cameraPreviewing, false);
  assert.equal(controls.snapshot().cameraSessionId, undefined);
  assert.equal(controls.snapshot().cameraAvailable, false); assert.equal(controls.snapshot().cameraVisible, false);
  await assert.rejects(controls.control({ type: 'camera-shape', value: 'square' }));
  controls.preparePreview(firstId, natural); controls.endPreview();
  assert.equal(controls.snapshot().cameraAvailable, false);
  assert.equal(controls.snapshot().cameraPreviewing, false);
  assert.equal(nativeCalls(), 0);
});

test('preview accepts camera-only edits, preserves effect patches, and rejects stop/audio without native requests', async () => {
  const { controls, nativeCalls } = controller(); controls.preparePreview(firstId, natural);
  await controls.control({ type: 'camera-effects', value: { filter: 'mono' } });
  await controls.control({ type: 'camera-effects', value: { intensity: 1 } });
  assert.deepEqual(controls.snapshot().cameraEffects, mono);
  await controls.control({ type: 'camera-visible', value: false });
  assert.equal(controls.snapshot().cameraVisible, false);
  await controls.control({ type: 'camera-visible', value: true });
  const before = controls.snapshot();
  for (const action of [{ type: 'stop' }, { type: 'microphone-muted', value: true }, { type: 'system-muted', value: true }] as const) {
    await assert.rejects(controls.control(action)); assert.deepEqual(controls.snapshot(), before);
  }
  for (const patch of [{}, { unknown: 1 }, { brightness: NaN }]) {
    await assert.rejects(controls.control({ type: 'camera-effects', value: patch as Partial<CameraEffects> }));
    assert.deepEqual(controls.snapshot(), before);
  }
  assert.deepEqual(controls.keyframes(10), []); assert.deepEqual(controls.effectsKeyframes(10), []);
  assert.equal(nativeCalls(), 0);
});

test('preview placement is bounded and persists without keyframes or invalid preference writes', async () => {
  await preferencesFixture(async (preferences, reopen) => {
    const { controls, nativeCalls } = controller(preferences); controls.preparePreview(firstId, natural);
    controls.placement({ x: -2, y: 3 }); preferences.flush();
    assert.equal(reopen().read().camera.x, 0); assert.equal(reopen().read().camera.y, 1);
    controls.placement({ x: NaN, y: .4 }); controls.placement({ x: .3, y: Infinity });
    preferences.flush();
    assert.equal(reopen().read().camera.x, 0); assert.equal(reopen().read().camera.y, 1);
    controls.endPreview(firstId); controls.placement({ x: .5, y: .5 }); preferences.flush();
    assert.equal(reopen().read().camera.x, 0); assert.equal(reopen().read().camera.y, 1);
    assert.deepEqual(controls.keyframes(10), []); assert.equal(nativeCalls(), 0);
  });
});

test('preview drag, shape, size, mirror and effects become recording t=0; late preview cleanup cannot clear capture', async context => {
  let now = 1000; context.mock.method(Date, 'now', () => now);
  await preferencesFixture(async (preferences, reopen) => {
    const fixture = controller(preferences), { controls } = fixture;
    controls.preparePreview(firstId, natural); controls.placement({ x: .19, y: .37 });
    await controls.control({ type: 'camera-shape', value: 'capsule' });
    await controls.control({ type: 'camera-size', value: .36 });
    await controls.control({ type: 'camera-mirror', value: false });
    await controls.control({ type: 'camera-effects', value: mono });
    preferences.flush();
    const initialLayout = { x: .19, y: .37, shape: 'capsule', size: .36, mirror: false, visible: true };
    assert.deepEqual(reopen().read().camera, initialLayout);
    assert.deepEqual(controls.keyframes(10), []); assert.deepEqual(controls.effectsKeyframes(10), []);
    controls.reset(options); fixture.setStatus('starting');
    assert.equal(controls.snapshot().cameraPreviewing, false); assert.equal(controls.snapshot().cameraSessionId, firstId);
    const starting = controls.snapshot(); controls.endPreview(firstId);
    assert.deepEqual(controls.snapshot(), starting);
    await assert.rejects(controls.control({ type: 'camera-shape', value: 'square' }));
    fixture.setStatus('recording'); controls.start(now);
    assert.deepEqual(controls.keyframes(10), [{ t: 0, ...initialLayout }]);
    assert.deepEqual(controls.effectsKeyframes(10), [{ t: 0, effects: mono }]);
    const recording = controls.snapshot(); controls.endPreview();
    assert.deepEqual(controls.snapshot(), recording);
    now = 1500; await controls.control({ type: 'camera-shape', value: 'portrait' });
    assert.deepEqual(controls.keyframes(1), [{ t: 0, ...initialLayout }, { t: .5, ...initialLayout, shape: 'portrait' }]);
    assert.deepEqual(controls.effectsKeyframes(1), [{ t: 0, effects: mono }]);
    assert.equal(fixture.nativeCalls(), 0);
  });
});
