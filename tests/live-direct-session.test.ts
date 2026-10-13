import assert from 'node:assert/strict';
import test from 'node:test';
import { liveFixture } from './live-session-harness';

const options = { sourceId: 'screen:fixture', output: 'stream', streamProfileId: 'e4b7a7aa-3026-454f-8990-b68544b6c0af',
  systemAudio: true, microphone: true, microphoneDeviceId: 'owned-mic' };
test('direct output bypasses camera installation, uses selected audio and encoding and forwards native PCM clock', async () => {
  const fixture = await liveFixture(); fixture.deviceInstalled = false;
  const config = await fixture.session.start(options);
  try {
    assert.equal(config.width, 1280); assert.equal(config.height, 720); assert.equal(config.fps, 60);
    assert.equal(fixture.nativeOptions?.microphone, true); assert.equal(fixture.nativeOptions?.systemAudio, true);
    assert.equal(fixture.nativeOptions?.liveAudio, true); assert.equal(fixture.nativeOptions?.microphoneDeviceId, 'owned-mic');
    await fixture.session.pull(config.id); await fixture.session.push(config.id, new ArrayBuffer(config.width * config.height * 4));
    assert.equal(fixture.streamAudio.length, 1); assert.equal(fixture.streamAudio[0].time, 9.8);
    assert.equal(fixture.streamWrites[0].time, 10);
    fixture.streamChanged?.({ status: 'reconnecting', attempt: 1, bitrate: 0, frames: 10, dropped: 0 });
    assert.equal(fixture.session.state.status, 'live'); assert.equal(fixture.session.state.connection?.status, 'reconnecting');
  } finally { await fixture.session.stop(); }
  assert.equal(fixture.stoppedWriter, 1); assert.equal(fixture.stoppedNative, 1);
});
test('profile failures happen before native capture or UI preparation', async () => {
  const fixture = await liveFixture(); fixture.streamProfileError = new Error('Cannot decrypt fixture');
  await assert.rejects(fixture.session.start(options), /Cannot decrypt/);
  assert.equal(fixture.prepared, 0); assert.equal(fixture.native, undefined);
});
test('fatal stream errors release the session and stop callbacks cannot revive a stopped session', async () => {
  const fixture = await liveFixture(); await fixture.session.start(options);
  fixture.streamFailed?.(new Error('Owned endpoint rejected connection'));
  await fixture.session.stop();
  assert.equal(fixture.session.state.status, 'error'); assert.equal(fixture.stoppedWriter, 1);
  fixture.streamChanged?.({ status: 'streaming', attempt: 0, bitrate: 4500, frames: 100, dropped: 0 });
  assert.equal(fixture.session.state.status, 'error');
});
test('callbacks from an ended stream cannot change a replacement stream', async () => {
  const fixture = await liveFixture(); await fixture.session.start(options);
  const oldChanged = fixture.streamChanged, oldFailed = fixture.streamFailed;
  await fixture.session.stop(); await fixture.session.start(options);
  oldChanged?.({ status: 'failed', attempt: 5, bitrate: 0, frames: 0, dropped: 0, error: 'Old connection' });
  oldFailed?.(new Error('Old connection'));
  assert.equal(fixture.session.state.status, 'live');
  assert.notEqual(fixture.session.state.connection?.status, 'failed');
  assert.equal(fixture.stoppedWriter, 1);
  await fixture.session.stop(); assert.equal(fixture.stoppedWriter, 2);
});
