import assert from 'node:assert/strict';
import test from 'node:test';
import { readRecordingDevicePreference, saveRecordingDevicePreference } from '../src/services/recording-device-preferences';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('camera and microphone choices persist independently without activation fields', () => {
  const storage = memoryStorage();
  const microphoneId = '{0.0.1.00000000}.{DJI-input-device}';
  saveRecordingDevicePreference('camera', 'camera-exact-id', storage);
  saveRecordingDevicePreference('microphone', microphoneId, storage);
  assert.equal(readRecordingDevicePreference('camera', storage), 'camera-exact-id');
  assert.equal(readRecordingDevicePreference('microphone', storage), microphoneId);
  assert.equal(storage.values.size, 2);
  assert.ok([...storage.values.values()].every(value => typeof JSON.parse(value) === 'string'));
  saveRecordingDevicePreference('microphone', '', storage);
  assert.equal(readRecordingDevicePreference('microphone', storage), '');
  assert.equal(readRecordingDevicePreference('camera', storage), 'camera-exact-id');
});

test('missing or malformed storage cannot introduce a device or rewrite saved data', () => {
  const storage = memoryStorage();
  assert.equal(readRecordingDevicePreference('camera', storage), '');
  assert.equal(storage.values.size, 0);
  const invalid = ['{', 'null', 'true', '42', '[]', '{"deviceId":"other"}', '"   "', JSON.stringify('x'.repeat(4097)), JSON.stringify('device\ninvalid')];
  for (const value of invalid) {
    storage.setItem('frameflow.recordingDevice.camera.v1', value);
    assert.equal(readRecordingDevicePreference('camera', storage), '');
    assert.equal(storage.getItem('frameflow.recordingDevice.camera.v1'), value);
  }
});

test('a denied or full storage leaves recording device choices usable', () => {
  const denied = {
    getItem: () => { throw new Error('Access denied'); },
    setItem: () => { throw new Error('Quota exceeded'); },
    removeItem: () => { throw new Error('Access denied'); },
  };
  assert.equal(readRecordingDevicePreference('microphone', denied), '');
  assert.doesNotThrow(() => saveRecordingDevicePreference('camera', 'camera-id', denied));
  assert.doesNotThrow(() => saveRecordingDevicePreference('microphone', '', denied));
});

test('invalid writes preserve the previous explicit device choice', () => {
  const storage = memoryStorage();
  saveRecordingDevicePreference('microphone', 'DJI', storage);
  for (const value of ['   ', '\u0000', 'x'.repeat(4097)]) saveRecordingDevicePreference('microphone', value, storage);
  assert.equal(readRecordingDevicePreference('microphone', storage), 'DJI');
});
