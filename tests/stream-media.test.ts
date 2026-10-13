import assert from 'node:assert/strict';
import test from 'node:test';
import { StreamMediaBuffer } from '../electron/services/streaming/media-buffer';
import { streamArguments, scrubStreamError, streamFailure } from '../electron/services/streaming/encoding';
import { DEFAULT_STREAM_ENCODING } from '../shared/streaming';

test('native-time PCM pads missing samples, clips invalid inputs and cannot replay overwritten audio', () => {
  const media = new StreamMediaBuffer(); const samples = Buffer.alloc(16);
  samples.writeFloatLE(.25, 0); samples.writeFloatLE(2, 4); samples.writeFloatLE(NaN, 8); samples.writeFloatLE(-.5, 12);
  media.audio(samples, 1);
  assert.equal(media.latestAudioTime, 1 + 2 / 48000);
  const output = media.takeAudio(1, 3);
  assert.equal(output.readFloatLE(0), .25); assert.equal(output.readFloatLE(4), 1);
  assert.equal(output.readFloatLE(8), 0); assert.equal(output.readFloatLE(12), -.5); assert.equal(output.readFloatLE(16), 0);
  media.audio(Buffer.alloc(16), 4); assert.ok(media.takeAudio(1, 3).equals(Buffer.alloc(24)));
  assert.throws(() => media.audio(Buffer.alloc(9), 1)); assert.throws(() => media.audio(Buffer.alloc(8), NaN));
});
test('video history is bounded and selects capture-time frames independently of arrival speed', () => {
  const media = new StreamMediaBuffer();
  for (let index = 0; index < 20; index++) { const frame = new Uint8Array([index]); media.video(frame.buffer, index); }
  assert.equal(media.dropped, 8); assert.equal(media.takeVideo(15)?.[0], 15); assert.equal(media.latestTime, 19);
  media.clear(); assert.equal(media.latestTime, undefined); assert.equal(media.latestAudioTime, undefined);
});
test('encoding uses H264/AAC and exact GOP while sensitive destinations and credentials are redacted', () => {
  const profile = { ...DEFAULT_STREAM_ENCODING, id: 'fixture', name: 'fixture', keyframeSeconds: 3, server: 'rtmps://example.test/live', key: 'abc$`test' };
  const args = streamArguments(profile, 1280, 720, 'private-audio-pipe', 'libx264');
  assert.equal(args[args.indexOf('-g') + 1], '90'); assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.equal(args[args.indexOf('-x264-params') + 1], 'nal-hrd=cbr:force-cfr=1');
  assert.equal(args[args.indexOf('-use_wallclock_as_timestamps') + 1], '1');
  assert.ok(args.indexOf('-use_wallclock_as_timestamps') < args.indexOf('pipe:0'));
  assert.equal(args[args.indexOf('-fps_mode') + 1], 'cfr'); assert.equal(args[args.indexOf('-r') + 1], String(profile.fps));
  const uppercase = streamArguments({ ...profile, server: 'RTMPS://example.test/live' }, 1280, 720, 'private-audio-pipe', 'libx264');
  assert.equal(uppercase[uppercase.indexOf('-tls_verify') + 1], '1');
  assert.equal(args.at(-1), profile.server + '/' + profile.key);
  const error = scrubStreamError(`failed ${args.at(-1)} ${profile.key} ${encodeURIComponent(profile.key)}`, profile);
  assert.ok(!error.includes(profile.key)); assert.ok(!error.includes(profile.server));
  assert.equal(streamFailure('403 forbidden').retry, false); assert.equal(streamFailure('connection reset').retry, true);
});
test('a verified-TLS certificate failure stops while transport interruption may retry', () => {
  assert.equal(streamFailure('RTMPS certificate verification failed').retry, false);
  assert.match(streamFailure('RTMPS certificate verification failed').message, /证书验证失败/);
  assert.equal(streamFailure('RTMPS transport connection failed').retry, true);
});
