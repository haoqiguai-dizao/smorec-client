import assert from 'node:assert/strict';
import test from 'node:test';
import { recordingOutputSize } from '../shared/recording';
import { recordingOptions } from '../electron/services/validation';
import { readAppPreferences, updateAppPreferences, APP_PREFERENCES_KEY, APP_PREFERENCE_FIELD_PREFIX } from '../src/services/app-preferences';

test('native screen, portrait and cropped physical pixels are preserved with H264 alignment', () => {
  assert.deepEqual(recordingOutputSize(3840, 2160), { width: 3840, height: 2160 });
  assert.deepEqual(recordingOutputSize(2160, 3840), { width: 2160, height: 3840 });
  assert.deepEqual(recordingOutputSize(1005, 667), { width: 1004, height: 666 });
  assert.deepEqual(recordingOutputSize(7680, 4320), { width: 7680, height: 4320 });
});

test('chosen presets downsample with aspect preserved and never upscale a smaller source', () => {
  assert.deepEqual(recordingOutputSize(3840, 2160, '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(recordingOutputSize(3840, 2160, '1440p'), { width: 2560, height: 1440 });
  assert.deepEqual(recordingOutputSize(2160, 3840, '1440p'), { width: 1440, height: 2560 });
  assert.deepEqual(recordingOutputSize(7680, 2160, '2160p'), { width: 3840, height: 1080 });
  assert.deepEqual(recordingOutputSize(640, 480, '2160p'), { width: 640, height: 480 });
  assert.deepEqual(recordingOutputSize(3841, 2160, '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(recordingOutputSize(2160, 3841, '1080p'), { width: 1080, height: 1920 });
});

test('unsupported native sizes fail explicitly while an explicit preset can reduce them', () => {
  for (const [w, h] of [[NaN, 1080], [1920, Infinity], [0, 1], [20000, 100], [16384, 2160], [8192, 8192]]) {
    assert.throws(() => recordingOutputSize(w, h));
  }
  assert.deepEqual(recordingOutputSize(16384, 4096, '2160p'), { width: 3840, height: 960 });
});

test('IPC forwards explicit recording resolution, defaults legacy calls to native and rejects unknown policies', () => {
  const options = { sourceId: 'screen:test', fps: 60, microphone: false, systemAudio: false };
  assert.equal(recordingOptions(options).resolution, 'native');
  assert.equal(recordingOptions({ ...options, resolution: '2160p' }).resolution, '2160p');
  assert.throws(() => recordingOptions({ ...options, resolution: 'fake4k' }));
});

test('recording exclusions survive IPC validation without accepting invalid application identities', () => {
  const options = { sourceId: 'screen:test', fps: 60, microphone: false, systemAudio: false };
  const id = process.platform === 'darwin' ? 'com.apple.Notes' : 'C:\\Apps\\Notes.exe';
  assert.deepEqual(recordingOptions({ ...options, excludedApplications: [id, id] }).excludedApplications, [id]);
  assert.equal(recordingOptions(options).excludedApplications, undefined);
  assert.throws(() => recordingOptions({ ...options, excludedApplications: ['invalid\napplication'] }));
  assert.throws(() => recordingOptions({ ...options, excludedApplications: Array(33).fill(id) }));
});

test('missing resolution preferences default to 1440p; resolution survives restart and unrelated device changes', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  values.set(APP_PREFERENCES_KEY, JSON.stringify({ version: 1, recording: { fps: 60 } }));
  assert.equal(readAppPreferences(storage).recording.resolution, '1440p');
  updateAppPreferences({ recording: { resolution: '2160p' } }, storage);
  updateAppPreferences({ recording: { cameraEnabled: false } }, storage);
  assert.equal(readAppPreferences(storage).recording.resolution, '2160p');
  assert.equal(readAppPreferences(storage).recording.fps, 60);
  values.set(APP_PREFERENCE_FIELD_PREFIX + 'recording.resolution', JSON.stringify('unsupported'));
  assert.equal(readAppPreferences(storage).recording.resolution, '1440p');
});
