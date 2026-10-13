import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import type { DesktopPreferences } from '../electron/services/desktop-preferences';
import type { NativeClient } from '../electron/services/native-client';
import type { LiveRecordingState, RecordingState } from '../shared/types';

const firstId = 'f21aa43f-5d09-4cfe-ae30-0163fb085fc9';
const secondId = '80c3ff05-ccdb-420c-b38c-2adfb91ecf63';
const options = { sourceId: 'screen:fixture', fps: 30 as const, microphone: false, systemAudio: false, cameraSessionId: firstId };

function fixture(status: RecordingState['status'] = 'idle') {
  let state: RecordingState = { status };
  const events: LiveRecordingState[] = [];
  let nativeCalls = 0, preferenceWrites = 0;
  const native = { request: async () => { nativeCalls++; throw new Error('No capture during countdown'); } } as unknown as NativeClient;
  const preferences = { read: () => ({ cameraMode: 'presenter', camera: { x: .5, y: .5, size: .22,
    shape: 'circle', mirror: true, visible: true } }), update: () => { preferenceWrites++; } } as unknown as DesktopPreferences;
  const controls = new LiveRecordingControls(native, () => state, () => events.push(controls.snapshot()), preferences);
  controls.preparePreview(firstId);
  events.length = 0;
  return { controls, events, state: (next: RecordingState['status']) => { state = { status: next }; },
    nativeCalls: () => nativeCalls, preferenceWrites: () => preferenceWrites };
}

test('preview countdown broadcasts 3, 2, 1 and cancellation without recording or preference writes', () => {
  for (const status of ['idle', 'error'] as const) {
    const item = fixture(status);
    for (const value of [3, 2, 1, null]) item.controls.previewCountdown(firstId, value);
    assert.deepEqual(item.events.map(state => state.countdown), [3, 2, 1, undefined]);
    assert.ok(item.events.every(state => state.status === status && state.cameraPreviewing && state.cameraMode === 'presenter'));
    assert.equal(item.controls.snapshot().countdown, undefined);
    assert.deepEqual(item.controls.modeKeyframes(10), []);
    assert.equal(item.nativeCalls(), 0); assert.equal(item.preferenceWrites(), 0);
    item.controls.previewCountdown(firstId, null);
    assert.equal(item.events.length, 4, 'Repeated cancellation does not republish stale recording errors');
  }
});

test('invalid countdown messages cannot change preview state', () => {
  const { controls, events } = fixture();
  controls.previewCountdown(firstId, 3);
  const before = controls.snapshot();
  for (const value of [0, 4, -1, 1.5, NaN, Infinity, undefined, '3', true, {}]) {
    assert.throws(() => controls.previewCountdown(firstId, value), /倒计时无效/);
    assert.deepEqual(controls.snapshot(), before);
  }
  assert.equal(events.length, 1);
});

test('old camera countdown and cancellation do not change a replacement preview', () => {
  const { controls } = fixture();
  controls.previewCountdown(firstId, 2);
  controls.preparePreview(secondId);
  assert.equal(controls.snapshot().countdown, undefined);
  controls.previewCountdown(secondId, 3);
  const before = controls.snapshot();
  controls.previewCountdown(firstId, 1); controls.previewCountdown(firstId, null); controls.endPreview(firstId);
  assert.deepEqual(controls.snapshot(), before);
  controls.endPreview(secondId);
  assert.equal(controls.snapshot().countdown, undefined);
  controls.previewCountdown(secondId, 2);
  assert.equal(controls.snapshot().countdown, undefined);
});

test('recording startup clears countdown and late ticks cannot reintroduce it during or after failure', () => {
  const item = fixture();
  item.controls.previewCountdown(firstId, 1);
  item.controls.reset(options);
  for (const status of ['starting', 'recording', 'stopping', 'error', 'idle'] as const) {
    item.state(status);
    item.controls.previewCountdown(firstId, 3); item.controls.previewCountdown(firstId, null);
    assert.equal(item.controls.snapshot().countdown, undefined);
  }
  item.controls.preparePreview(secondId);
  item.controls.previewCountdown(secondId, 3);
  item.controls.previewCountdown(firstId, null);
  assert.equal(item.controls.snapshot().countdown, 3);
});

test('same-session effects refresh preserves countdown while ending preview clears it', () => {
  const { controls } = fixture();
  controls.previewCountdown(firstId, 2);
  controls.preparePreview(firstId);
  assert.equal(controls.snapshot().countdown, 2);
  controls.endPreview();
  assert.equal(controls.snapshot().countdown, undefined);
});
