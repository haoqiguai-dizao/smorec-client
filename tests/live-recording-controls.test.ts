import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import type { NativeClient } from '../electron/services/native-client';
import type { RecordingState } from '../shared/types';
import type { DesktopPreferences, DesktopPreferencePatch } from '../electron/services/desktop-preferences';

test('one camera-off action leaves presenter view and hides the camera while retaining the recorded source', async () => {
  const native = { request: async () => { throw new Error('must not restart capture'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status: 'recording' }), () => {});
  controls.reset({ sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false, cameraSessionId: 'owned-camera' });
  controls.start(Date.now());
  await controls.control({ type: 'camera-mode', value: 'presenter' });
  await controls.control({ type: 'camera-visible', value: false });
  assert.equal(controls.snapshot().cameraMode, 'overlay');
  assert.equal(controls.snapshot().cameraVisible, false);
  assert.equal(controls.snapshot().cameraAvailable, true);
  assert.equal(controls.snapshot().cameraSessionId, 'owned-camera');
});

test('live mute state changes only after native acceptance and preserves independent tracks', async () => {
  let status: RecordingState['status'] = 'recording';
  const requests: unknown[] = [];
  const native = { request: async (_command: string, value: unknown) => {
    requests.push(value); return { microphoneMuted: true, systemAudioMuted: false };
  } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status }), () => {});
  controls.reset({ sourceId: 'screen:1', fps: 30, microphone: true, systemAudio: true });
  await controls.control({ type: 'microphone-muted', value: true });
  assert.equal(controls.snapshot().microphoneMuted, true); assert.equal(controls.snapshot().systemAudioMuted, false);
  assert.deepEqual(requests, [{ options: { microphoneMuted: true } }]);
  status = 'stopping'; await assert.rejects(controls.control({ type: 'system-muted', value: true }));
});
test('failed mute is not shown as successful and unavailable tracks are rejected', async () => {
  const native = { request: async () => { throw new Error('device disconnected'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status: 'recording' }), () => {});
  controls.reset({ sourceId: 'screen:1', fps: 30, microphone: true, systemAudio: false });
  await assert.rejects(controls.control({ type: 'microphone-muted', value: true }));
  assert.equal(controls.snapshot().microphoneMuted, false);
  await assert.rejects(controls.control({ type: 'system-muted', value: true }));
  await assert.rejects(controls.control({ type: 'camera-visible', value: true }));
});
test('live webcam controls save layout without stopping or opening media devices', async () => {
  const native = { request: async () => { throw new Error('must not call native'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status: 'recording' }), () => {});
  controls.reset({ sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false, cameraSessionId: 'test-camera' });
  controls.start(Date.now() - 1000);
  controls.placement({ x: .2, y: .3 });
  await controls.control({ type: 'camera-shape', value: 'rounded' });
  await controls.control({ type: 'camera-visible', value: false });
  const frames = controls.keyframes(10);
  assert.equal(frames[0].t, 0); assert.equal(frames[0].visible, true);
  assert.equal(frames.at(-1)?.x, .2); assert.equal(frames.at(-1)?.shape, 'rounded');
  assert.equal(frames.at(-1)?.visible, false); assert.equal(controls.snapshot().cameraAvailable, true);
});

test('hiding a camera only affects this recording while explicit layout changes survive the next one', async () => {
  const camera = { x: .3, y: .4, size: .3, shape: 'rounded' as const, mirror: false, visible: true };
  const preferences = { read: () => ({ camera: { ...camera } }), update: (patch: DesktopPreferencePatch) => Object.assign(camera, patch.camera) } as unknown as DesktopPreferences;
  const native = { request: async () => { throw new Error('must not open devices'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status: 'recording' }), () => {}, preferences);
  const options = { sourceId: 'screen:1', fps: 30 as const, microphone: false, systemAudio: false, cameraSessionId: 'camera' };
  controls.reset(options); controls.start(Date.now() - 1000);
  await controls.control({ type: 'camera-visible', value: false });
  await controls.control({ type: 'camera-size', value: .35 });
  controls.placement({ x: .25, y: .5 });
  assert.equal(controls.keyframes(10).at(-1)?.visible, false);
  assert.equal(camera.visible, true, 'Temporary hiding must not create an invisible camera on the next recording');
  controls.reset(options); controls.start(Date.now());
  assert.equal(controls.snapshot().cameraVisible, true);
  assert.deepEqual(controls.keyframes(1)[0], { t: 0, ...camera });
  assert.equal(camera.size, .35); assert.equal(camera.x, .25); assert.equal(camera.mirror, false);
  controls.cameraUnavailable(); controls.reset(options);
  assert.equal(controls.snapshot().cameraVisible, true, 'Device failure must not change the saved visibility intent either');
});

test('late camera attachment starts visibility at the existing recording clock, with the earlier segment hidden', () => {
  const controls = new LiveRecordingControls({} as NativeClient, () => ({ status: 'recording' }), () => {});
  controls.reset({ sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false });
  controls.start(Date.now() - 10000); controls.attachCamera('late-camera');
  const frames = controls.keyframes(20);
  assert.equal(frames[0].visible, false); assert.equal(frames[0].t, 0);
  assert.equal(frames.at(-1)?.visible, true); assert.ok(frames.at(-1)!.t >= 10);
  assert.equal(controls.snapshot().cameraSessionId, 'late-camera');
});

test('audio input changes are serialized and a failed device choice leaves the accepted source intact', async () => {
  let accept!: (value: unknown) => void;
  const requests: string[] = [];
  const native = { request: async (_command: string, value: { options: { microphoneDeviceId: string } }) => {
    requests.push(value.options.microphoneDeviceId);
    if (requests.length === 1) return new Promise(resolve => { accept = resolve; });
    throw new Error('new device disconnected');
  } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status: 'recording' }), () => {});
  controls.reset({ sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: true });
  const first = controls.control({ type: 'microphone-source', value: { enabled: true, deviceId: 'accepted' } });
  const second = assert.rejects(controls.control({ type: 'microphone-source', value: { enabled: true, deviceId: 'missing' } }), /disconnected/);
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(requests, ['accepted']);
  assert.equal(controls.snapshot().microphoneEnabled, false);
  accept({ microphoneEnabled: true, microphoneMuted: false, microphoneDeviceId: 'accepted', systemAudioEnabled: true, systemAudioMuted: false });
  await first; await second;
  assert.equal(controls.snapshot().microphoneDeviceId, 'accepted'); assert.equal(controls.snapshot().microphoneEnabled, true);
  assert.equal(controls.snapshot().systemAudioEnabled, true);
});
