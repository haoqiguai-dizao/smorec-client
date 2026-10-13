import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock } from '../src/services/playback-clock';

test('follows media normally, then holds its final frame with an independently pausable tail', () => {
  let now = 0;
  const clock = new PlaybackClock(() => now), media = { currentTime: .4, duration: 1 };
  clock.play(); now = 600;
  assert.equal(clock.read(media), .4, 'decoder stalls must not become stretched footage');
  media.currentTime = 1; clock.ended(1); now = 1100;
  assert.equal(clock.read(media), 1.5);
  clock.pause(media); now = 4100;
  assert.equal(clock.read(media), 1.5);
  clock.play(); now = 4300;
  assert.equal(clock.read(media), 1.7);
});

test('tail seeks preserve requested source time, and a backward cut returns to the decoder', () => {
  let now = 0;
  const clock = new PlaybackClock(() => now), media = { currentTime: .999, duration: 1 };
  clock.seek(1.6, media.duration);
  assert.equal(clock.holding, true); assert.equal(clock.read(media), 1.6);
  clock.play(); now = 200;
  assert.equal(clock.read(media), 1.8);
  clock.seek(.2, media.duration); media.currentTime = .2;
  assert.equal(clock.holding, false); assert.equal(clock.read(media), .2);
  media.currentTime = .7; now = 700;
  assert.equal(clock.read(media), .7);
  clock.reset(); assert.equal(clock.holding, false);
});
