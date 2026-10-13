import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveCameraControls } from '../electron/services/live/camera-controls';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import type { NativeClient } from '../electron/services/native-client';
import { liveFixture } from './live-session-harness';
import { parseLiveOptions } from '../electron/services/live/validation';

test('custom exclusions retain an explicit empty list and detach case-insensitive application paths', () => {
  assert.deepEqual(parseLiveOptions({ sourceId: 'screen:fixture', excludedApplications: [] }).excludedApplications, []);
  const selected = ['C:\\Apps\\Browser.exe', 'c:\\apps\\browser.exe', 'D:/Tools/Helper.exe'];
  const options = parseLiveOptions({ sourceId: 'screen:fixture', excludedApplications: selected }, 'win32');
  selected.length = 0;
  assert.deepEqual(options.excludedApplications, ['c:\\apps\\browser.exe', 'D:\\Tools\\Helper.exe']);
  for (const ids of [['..\\tool.exe'], ['\\\\server\\share\\tool.exe'], ['C:\\app.exe:stream'],
    ['C:\\app.exe\n'], ['C:\\app.dll'], [42], Array.from({ length: 33 }, () => 'C:\\tool.exe')]) {
    assert.throws(() => parseLiveOptions({ sourceId: 'screen:fixture', excludedApplications: ids }, 'win32'), /排除应用/);
  }
});

function fixture() {
  let ready = true, shown = 0, opened = 0, effectsSent = 0;
  const controls = new LiveRecordingControls({ request: async () => { throw new Error('Live edits must not restart capture'); } } as unknown as NativeClient,
    () => ({ status: 'idle' }), () => {});
  controls.preparePreview('existing-camera');
  const camera = new LiveCameraControls({ ready: () => ready, controls, show: () => { shown++; },
    openSettings: () => { opened++; }, effectsChanged: () => { effectsSent++; } });
  return { controls, camera, ready: (value: boolean) => { ready = value; },
    counts: () => ({ shown, opened, effectsSent }) };
}

test('live camera edits retain the prepared device and reach the next composition snapshot', async () => {
  const { controls, camera, counts } = fixture();
  await camera.control({ type: 'camera-size', value: .35 });
  await camera.control({ type: 'camera-mirror', value: false });
  await camera.control({ type: 'camera-shape', value: 'rounded' });
  await camera.control({ type: 'camera-effects', value: { brightness: .2 } });
  const state = controls.snapshot();
  assert.equal(state.cameraSize, .35);
  assert.equal(state.cameraMirror, false);
  assert.equal(state.cameraShape, 'rounded');
  assert.equal(state.cameraSessionId, 'existing-camera');
  assert.equal(state.cameraAvailable, true);
  assert.equal(state.cameraPreviewing, true);
  assert.equal(counts().effectsSent, 1);
  assert.deepEqual(controls.keyframes(10), [], 'Live adjustments must not create recording keyframes');
});

test('hiding output keeps the device and reopening settings restores that same camera', async () => {
  const { controls, camera, counts } = fixture();
  await camera.control({ type: 'camera-visible', value: false });
  assert.equal(controls.snapshot().cameraVisible, false);
  assert.equal(controls.snapshot().cameraAvailable, true);
  await camera.open();
  assert.equal(controls.snapshot().cameraVisible, true);
  assert.equal(controls.snapshot().cameraSessionId, 'existing-camera');
  assert.deepEqual(counts(), { shown: 1, opened: 1, effectsSent: 0 });
  await camera.control({ type: 'camera-visible', value: false });
  await camera.restore();
  assert.equal(controls.snapshot().cameraVisible, true, 'Temporary hiding must not persist into the next session');
});

test('startup, shutdown, unavailable cameras and recording-only controls remain gated', async () => {
  const { controls, camera, ready, counts } = fixture();
  ready(false);
  await assert.rejects(camera.open(), /准备/);
  await assert.rejects(camera.control({ type: 'camera-size', value: .3 }), /准备/);
  ready(true);
  await assert.rejects(camera.control({ type: 'microphone-muted', value: true }), /只能调整摄像头/);
  controls.endPreview();
  await assert.rejects(camera.open(), /开启摄像头/);
  await camera.restore();
  assert.deepEqual(counts(), { shown: 0, opened: 0, effectsSent: 0 });
});

test('camera settings pin the live toolbar only for the current live session', async () => {
  const { session, states } = await liveFixture();
  session.cameraSettingsChanged(true);
  assert.equal(states.length, 0);
  await session.start({ sourceId: 'screen:fixture' });
  session.cameraSettingsChanged(true);
  assert.equal(session.state.cameraSettingsOpen, true);
  const count = states.length;
  session.cameraSettingsChanged(true);
  assert.equal(states.length, count, 'Repeated HUD paints must not recursively publish');
  session.cameraSettingsChanged(false);
  assert.equal(session.state.cameraSettingsOpen, false);
  await session.stop();
  assert.equal(session.state.cameraSettingsOpen, undefined);
});
