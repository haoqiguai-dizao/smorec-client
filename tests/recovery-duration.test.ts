import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryPresentationDuration } from '../electron/services/recovery-duration';

const complete = { duration: 8.155110733333334, videoDuration: 8, tailHold: 0.15511073333333414 };

test('final recording preserves the verified static tail across recovery', () => {
  assert.equal(recoveryPresentationDuration(8, complete, true), complete.duration);
});

test('unfinished recovery metadata cannot enlarge the probed duration', () => {
  assert.equal(recoveryPresentationDuration(8, complete, false), 8);
});

test('ordinary and legacy recordings retain their original probed duration', () => {
  for (const metadata of [{}, { duration: 20 }, { duration: 8.003, videoDuration: 8.003, tailHold: 0 }]) {
    assert.equal(recoveryPresentationDuration(8, metadata, true), 8);
  }
});

test('duration metadata must match the actual video and its own tail arithmetic', () => {
  assert.equal(recoveryPresentationDuration(9, complete, true), 9);
  assert.equal(recoveryPresentationDuration(8, { ...complete, duration: 9 }, true), 8);
  assert.equal(recoveryPresentationDuration(8, { ...complete, tailHold: 0.1 }, true), 8);
});

test('nonfinite, malformed, negative, and excessive metadata cannot change recovery', () => {
  for (const metadata of [
    { ...complete, duration: NaN }, { ...complete, duration: Infinity },
    { ...complete, videoDuration: Infinity }, { ...complete, videoDuration: 0 },
    { ...complete, tailHold: NaN }, { ...complete, tailHold: -0.1 },
    { ...complete, duration: '8.155' }, { ...complete, tailHold: undefined },
    { duration: 86401, videoDuration: 8, tailHold: 86393 },
  ]) assert.equal(recoveryPresentationDuration(8, metadata, true), 8);
});

test('probe rounding is tolerated without allowing metadata to shorten the video', () => {
  const rounded = { duration: 8.156, videoDuration: 8.006, tailHold: 0.15 };
  assert.equal(recoveryPresentationDuration(8.01, rounded, true), 8.156);
  assert.equal(recoveryPresentationDuration(8.02, { duration: 8.011, videoDuration: 8.01, tailHold: 0.001 }, true), 8.02);
});
