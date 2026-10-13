import test from 'node:test';
import assert from 'node:assert/strict';
import { audioMixGains } from '../shared/audio-mix';
import { applyPreviewAudioMix } from '../src/services/preview-audio';
import { exportAudioFilters } from '../electron/services/export-audio';

test('single audible input retains its level, including missing and muted companions', () => {
  for (const volume of [0, .2, .5, 1]) {
    assert.deepEqual(audioMixGains([volume]), [volume]);
    assert.deepEqual(audioMixGains([volume, 0]), [volume, 0]);
    assert.deepEqual(audioMixGains([0, volume]), [0, volume]);
  }
});

test('multiple sliders remain literal gains; a silent system recording cannot reduce the microphone', () => {
  assert.deepEqual(audioMixGains([.2, .3]), [.2, .3]);
  for (const levels of [[1, 1], [1, .5], [.7, .4], [1, 1, 1]]) {
    const gains = audioMixGains(levels);
    assert.deepEqual(gains, levels);
  }
  assert.deepEqual(audioMixGains([NaN, Infinity, -1, 2]), [0, 0, 0, 1]);
});

test('preview receives export gains and never plays embedded audio twice', () => {
  const video = { volume: 1, muted: false }, tracks = { system: { volume: 1 }, microphone: { volume: 1 } };
  applyPreviewAudioMix(video, tracks, { system: 1, microphone: .5 });
  assert.deepEqual([tracks.system.volume, tracks.microphone.volume], audioMixGains([1, .5]));
  assert.equal(video.muted, true); assert.equal(video.volume, 0);
  applyPreviewAudioMix(video, tracks, { system: 1, microphone: 0 });
  assert.equal(tracks.system.volume, 1); assert.equal(tracks.microphone.volume, 0);
  applyPreviewAudioMix(video, {}, { system: .8, microphone: 1 });
  assert.equal(video.muted, false); assert.equal(video.volume, .8);
});

test('preview plays its prepared mix at unity and silences other media elements', () => {
  const video = { volume: 1, muted: false }, tracks = { mix: { volume: 0 }, system: { volume: 1 }, microphone: { volume: 1 } };
  applyPreviewAudioMix(video, tracks, { system: .5, microphone: .25 });
  assert.deepEqual(tracks, { mix: { volume: 1 }, system: { volume: 0 }, microphone: { volume: 0 } });
  assert.equal(video.muted, true); assert.equal(video.volume, 0);
});

test('export cuts the prepared audio without another limiter or mix normalization', () => {
  const clips = [{ id: 'a', start: 1, end: 2 }, { id: 'b', start: 3, end: 4.25 }];
  const filters = exportAudioFilters([1], clips, 2.25);
  assert.ok(filters.includes('volume=1,apad,atrim=duration=2.250000'));
  assert.equal((filters.match(/asplit=2/g) ?? []).length, 1);
  assert.equal((filters.match(/concat=n=2/g) ?? []).length, 1);
  assert.ok(!filters.includes('amix') && !filters.includes('alimiter'));
  assert.throws(() => exportAudioFilters([1, 1], clips, 2.25), /shared project audio/);
});
