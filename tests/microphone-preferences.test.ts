import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MICROPHONE_EFFECTS, microphonePreset } from '../shared/microphone-effects';
import { readMicrophoneEffects, saveMicrophoneEffects } from '../src/services/microphone-preferences';

function storage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); } };
}

test('fresh microphone preferences use natural automatic leveling and independent snapshots', () => {
  const local = storage();
  const first = readMicrophoneEffects('', local);
  assert.deepEqual(first, DEFAULT_MICROPHONE_EFFECTS);
  assert.equal(first.autoLevel.enabled, true);
  first.autoLevel.maxGainDb = 1;
  assert.equal(readMicrophoneEffects('', local).autoLevel.maxGainDb, 12);
});

test('microphone settings restore disabled effects and remain isolated between device IDs', () => {
  const local = storage();
  const first = microphonePreset('warm'); first.enabled = false; first.autoLevel.maxGainDb = 7;
  saveMicrophoneEffects('usb/a%2Fb', first, local);
  saveMicrophoneEffects('usb/a/b', microphonePreset('clear'), local);
  assert.deepEqual(readMicrophoneEffects('usb/a%2Fb', local), first);
  assert.deepEqual(readMicrophoneEffects('usb/a/b', local), microphonePreset('clear'));
  assert.deepEqual(readMicrophoneEffects('', local), DEFAULT_MICROPHONE_EFFECTS);
});

test('corrupt or unavailable microphone preferences do not block recording preparation', () => {
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
  assert.deepEqual(readMicrophoneEffects('device', blocked), DEFAULT_MICROPHONE_EFFECTS);
  assert.deepEqual(readMicrophoneEffects('device', { getItem: () => '{broken', setItem: () => {} }), DEFAULT_MICROPHONE_EFFECTS);
  assert.doesNotThrow(() => saveMicrophoneEffects('device', microphonePreset('original'), blocked));
});
