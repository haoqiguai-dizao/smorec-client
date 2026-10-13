import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { CameraMode, RecordingOptions, RecordingState } from '../shared/types';
import type { NativeClient } from '../electron/services/native-client';
import { DesktopPreferences } from '../electron/services/desktop-preferences';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import { parseOverlayControl } from '../electron/services/recording-overlay/validation';
import { presenterCameraBounds, toolbarOverlayBounds } from '../electron/services/recording-overlay/geometry';
import { launcherBounds } from '../electron/services/recorder-launcher/geometry';

const options: RecordingOptions = { sourceId: 'screen:synthetic', fps: 30, microphone: true, systemAudio: true, cameraSessionId: 'synthetic' };

test('portrait framing is validated, survives preview transition and locks at countdown and recording', async () => {
  const { controls, status, nativeCalls } = fixture(); controls.preparePreview('synthetic');
  const value = { aspect: '9:16' as const, crop: { x: .2, y: .8 } };
  assert.deepEqual(parseOverlayControl({ type: 'camera-presenter', value }), { type: 'camera-presenter', value });
  for (const invalid of [{ ...value, aspect: '1:1' }, { ...value, crop: { x: NaN, y: .5 } }, { ...value, crop: { x: 2, y: .5 } }]) {
    assert.throws(() => parseOverlayControl({ type: 'camera-presenter', value: invalid }));
  }
  await controls.control({ type: 'camera-presenter', value });
  controls.previewCountdown('synthetic', 3);
  await assert.rejects(controls.control({ type: 'camera-presenter', value }));
  controls.reset(options); status('recording'); controls.start(Date.now());
  assert.deepEqual(controls.snapshot().cameraPresenter, value);
  await assert.rejects(controls.control({ type: 'camera-presenter', value }));
  const snapshot = controls.snapshot(); snapshot.cameraPresenter!.crop.x = 0;
  assert.equal(controls.snapshot().cameraPresenter!.crop.x, .2); assert.equal(nativeCalls(), 0);
});

test('portrait preview fits every work area with exact inner 9:16 geometry', () => {
  for (const area of [{ x: -1920, y: 0, width: 1920, height: 1040 }, { x: 0, y: 0, width: 1280, height: 680 },
    { x: 0, y: 0, width: 320, height: 180 }]) {
    const bounds = presenterCameraBounds(area, { x: .5, y: .5 }, '9:16');
    assert.equal((bounds.width - 12) * 16, (bounds.height - 12) * 9);
    assert.ok(bounds.x >= area.x && bounds.y >= area.y);
    assert.ok(bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height);
  }
});
test('portrait preview leaves both default recording bars clear, even when dragged to the bottom', () => {
  for (const area of [{ x: -1920, y: -40, width: 1920, height: 1040 }, { x: 0, y: 0, width: 1280, height: 680 },
    { x: 2560, y: 0, width: 1536, height: 824 }, { x: 0, y: 0, width: 720, height: 1240 }]) {
    for (const center of [{ x: .5, y: .5 }, { x: .5, y: 1 }]) {
      const bounds = presenterCameraBounds(area, center, '9:16');
      assert.equal((bounds.width - 12) * 16, (bounds.height - 12) * 9);
      for (const bar of [launcherBounds(area), toolbarOverlayBounds(area, false)]) {
        assert.ok(bounds.y + bounds.height + 12 <= bar.y, 'Portrait preview must leave a gap above the recording controls');
      }
    }
  }
});

function fixture(preferences?: DesktopPreferences) {
  let status: RecordingState['status'] = 'idle', nativeCalls = 0;
  const native = { request: async () => { nativeCalls++; throw new Error('No device access allowed'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status }), () => {}, preferences);
  return { controls, status: (next: RecordingState['status']) => { status = next; }, nativeCalls: () => nativeCalls };
}

test('preview presenter selection becomes t=0 without touching media or the small-camera layout', async context => {
  context.mock.method(Date, 'now', () => 1000);
  const { controls, status, nativeCalls } = fixture();
  controls.preparePreview('synthetic');
  await controls.control({ type: 'camera-mode', value: 'presenter' });
  assert.equal(controls.snapshot().cameraMode, 'presenter');
  assert.deepEqual(controls.modeKeyframes(10), []);
  controls.reset(options); status('starting'); controls.endPreview('synthetic');
  assert.equal(controls.snapshot().cameraMode, 'presenter');
  status('recording'); controls.start(1000);
  const layout = controls.keyframes(10), effects = controls.effectsKeyframes(10);
  assert.deepEqual(controls.modeKeyframes(10), [{ t: 0, mode: 'presenter' }]);
  controls.placement({ x: .1, y: .2 });
  assert.deepEqual(controls.keyframes(10), layout);
  await controls.control({ type: 'camera-mode', value: 'overlay' });
  assert.deepEqual(controls.keyframes(10), layout);
  assert.deepEqual(controls.effectsKeyframes(10), effects);
  assert.equal(controls.snapshot().microphoneEnabled, true);
  assert.equal(controls.snapshot().systemAudioEnabled, true);
  assert.equal(nativeCalls(), 0);
});

test('rapid mode switches preserve every exact transition and are independent of layout/effect buckets', async context => {
  let now = 1000; context.mock.method(Date, 'now', () => now);
  const { controls, status, nativeCalls } = fixture();
  controls.reset(options); status('recording'); controls.start(now);
  const initialLayout = controls.keyframes(10);
  for (const [time, mode] of [[1010, 'presenter'], [1020, 'overlay'], [1021, 'presenter'], [1021, 'overlay']] as const) {
    now = time; await controls.control({ type: 'camera-mode', value: mode });
  }
  assert.deepEqual(controls.modeKeyframes(10), [
    { t: 0, mode: 'overlay' }, { t: .01, mode: 'presenter' }, { t: .02, mode: 'overlay' },
    { t: .021, mode: 'presenter' }, { t: .021, mode: 'overlay' },
  ]);
  assert.equal(controls.modeKeyframes(.02).length, 3);
  const detached = controls.modeKeyframes(10); detached[0].mode = 'presenter';
  assert.equal(controls.modeKeyframes(10)[0].mode, 'overlay');
  await controls.control({ type: 'camera-mode', value: 'overlay' });
  assert.equal(controls.modeKeyframes(10).length, 5, 'A repeated selection is not a transition');
  assert.deepEqual(controls.keyframes(10), initialLayout);
  assert.equal(nativeCalls(), 0);
});

test('presenter makes a hidden camera visible without overwriting the saved small-camera shape, size or position', async () => {
  const { controls, status } = fixture(); controls.reset(options); status('recording'); controls.start(Date.now());
  controls.placement({ x: .21, y: .38 });
  await controls.control({ type: 'camera-shape', value: 'capsule' });
  await controls.control({ type: 'camera-size', value: .36 });
  await controls.control({ type: 'camera-visible', value: false });
  const layout = controls.keyframes(10);
  await controls.control({ type: 'camera-mode', value: 'presenter' });
  assert.equal(controls.snapshot().cameraVisible, true);
  controls.placement({ x: .8, y: .7 });
  await controls.control({ type: 'camera-mode', value: 'overlay' });
  assert.equal(controls.snapshot().cameraVisible, false);
  assert.equal(controls.snapshot().cameraShape, 'capsule'); assert.equal(controls.snapshot().cameraSize, .36);
  assert.deepEqual(controls.keyframes(10), layout);
});

test('mode preference survives a new store and does not contaminate layout or legacy defaults', async () => {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'camera-mode-preferences-'));
  const preferences = new DesktopPreferences(() => directory);
  try {
    assert.equal(preferences.read().cameraMode, 'overlay');
    const originalLayout = preferences.read().camera;
    const { controls } = fixture(preferences); controls.preparePreview('synthetic');
    await controls.control({ type: 'camera-mode', value: 'presenter' });
    await controls.control({ type: 'camera-presenter', value: { aspect: '9:16', crop: { x: .3, y: .6 } } });
    controls.placement({ x: .1, y: .1 }); preferences.flush();
    const restored = new DesktopPreferences(() => directory);
    assert.equal(restored.read().cameraMode, 'presenter'); assert.deepEqual(restored.read().camera, originalLayout);
    const fresh = fixture(restored); fresh.controls.preparePreview('replacement');
    assert.equal(fresh.controls.snapshot().cameraMode, 'presenter');
    assert.deepEqual(fresh.controls.snapshot().cameraPresenter, { aspect: '9:16', crop: { x: .3, y: .6 } });
    restored.update({ cameraMode: 'invalid' as CameraMode }); restored.flush();
    assert.equal(restored.read().cameraMode, 'presenter');
    await fs.writeFile(path.join(directory, 'preferences.json'), JSON.stringify({ version: 1, camera: originalLayout }));
    assert.equal(new DesktopPreferences(() => directory).read().cameraMode, 'overlay');
  } finally {
    preferences.flush();
    const resolved = await fs.realpath(directory), relative = path.relative(output, resolved);
    assert.ok(relative.startsWith('camera-mode-preferences-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('camera mode IPC rejects invalid modes and unavailable or transitional camera state', async () => {
  for (const value of ['overlay', 'presenter']) assert.deepEqual(parseOverlayControl({ type: 'camera-mode', value }), { type: 'camera-mode', value });
  for (const value of [undefined, null, true, 0, 'landscape', 'OVERLAY', {}]) assert.throws(() => parseOverlayControl({ type: 'camera-mode', value }));
  const { controls, status } = fixture();
  controls.reset(options); status('starting'); await assert.rejects(controls.control({ type: 'camera-mode', value: 'presenter' }));
  status('recording'); const before = controls.snapshot();
  await assert.rejects(controls.control({ type: 'camera-mode', value: 'invalid' as CameraMode }));
  assert.deepEqual(controls.snapshot(), before);
  controls.cameraUnavailable(); await assert.rejects(controls.control({ type: 'camera-mode', value: 'presenter' }));
});

test('presenter native bounds keep an inner 16:9 image and safe margins on small and negative-coordinate monitors', () => {
  for (const area of [{ x: -1920, y: -40, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1280, height: 680 },
    { x: -600, y: -400, width: 320, height: 180 }, { x: 0, y: 0, width: 800, height: 320 }]) {
    for (const center of [{ x: .5, y: .5 }, { x: 0, y: 1 }, { x: NaN, y: Infinity }]) {
      const bounds = presenterCameraBounds(area, center);
      assert.equal((bounds.width - 12) * 9, (bounds.height - 12) * 16);
      assert.ok(bounds.width - 12 <= Math.min(960, area.width * .65));
      assert.ok(bounds.x >= area.x + 24 && bounds.y >= area.y + 24);
      assert.ok(bounds.x + bounds.width <= area.x + area.width - 24);
      assert.ok(bounds.y + bounds.height <= area.y + area.height - 24);
    }
  }
});
