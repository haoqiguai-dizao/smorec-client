import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MICROPHONE_EFFECTS, MICROPHONE_PRESETS, microphonePreset, normalizeMicrophoneEffects,
  ORIGINAL_MICROPHONE_EFFECTS } from '../shared/microphone-effects';

test('legacy microphone effects remain original and malformed settings cannot enter the DSP graph', () => {
  for (const missing of [undefined, null, [], 'natural']) assert.deepEqual(normalizeMicrophoneEffects(missing), ORIGINAL_MICROPHONE_EFFECTS);
  const normalized = normalizeMicrophoneEffects({ enabled: 'yes', preset: 'unknown', noiseReduction: 'system=command',
    compression: 5, deEss: NaN, highpass: { enabled: true, frequencyHz: -Infinity },
    eq: { lowDb: 999, presenceDb: -999, airDb: '6' }, expander: { thresholdDb: 10, ratio: 100 }, limiter: { ceilingDb: 0 } });
  assert.equal(normalized.enabled, false); assert.equal(normalized.noiseReduction, 'off');
  assert.equal(normalized.compression, 1); assert.equal(normalized.deEss, 0);
  assert.equal(normalized.highpass.frequencyHz, 80);
  assert.deepEqual(normalized.eq, { enabled: false, lowDb: 6, presenceDb: -6, airDb: 0 });
  assert.equal(normalized.expander.thresholdDb, -20); assert.equal(normalized.expander.ratio, 4);
  assert.equal(normalized.limiter.ceilingDb, -1);
});

test('presets are independent editable snapshots and natural defaults never alter original bypass', () => {
  const snapshots = MICROPHONE_PRESETS.map(({ id }) => microphonePreset(id));
  assert.equal(snapshots[0].enabled, false);
  assert.equal(snapshots[1].enabled, true);
  for (const snapshot of snapshots.slice(1)) assert.equal(snapshot.limiter.enabled, true);
  snapshots[1].eq.lowDb = -5;
  assert.equal(DEFAULT_MICROPHONE_EFFECTS.eq.lowDb, 0);
  assert.equal(microphonePreset('natural').eq.lowDb, 0);
  assert.notEqual(microphonePreset('clear').eq.presenceDb, microphonePreset('warm').eq.presenceDb);
});
