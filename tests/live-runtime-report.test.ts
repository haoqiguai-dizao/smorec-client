import assert from 'node:assert/strict';
import test from 'node:test';
import { liveFixture } from './live-session-harness';
import { LIVE_CAMERA_WARNING } from '../shared/live-issues';

const options = { sourceId: 'screen:fixture', output: 'stream', preview: true,
  streamProfileId: 'e4b7a7aa-3026-454f-8990-b68544b6c0af', systemAudio: true };

test('camera loss and recovery preserve broadcast, PCM forwarding and output resources', async () => {
  const fixture = await liveFixture(), { session } = fixture;
  const config = await session.start(options);
  try {
    await session.pull(config.id); await session.push(config.id, new ArrayBuffer(config.width * config.height * 4));
    await session.broadcast(config.id);
    await session.report(config.id, 'camera-unavailable');
    assert.equal(session.state.status, 'live'); assert.equal(session.state.phase, 'broadcast');
    assert.equal(session.state.error, LIVE_CAMERA_WARNING);
    await session.report(config.id, 'camera-unavailable'); assert.equal(session.state.error, LIVE_CAMERA_WARNING);
    await session.pull(config.id); await session.push(config.id, new ArrayBuffer(config.width * config.height * 4));
    assert.equal(fixture.streamAudio.length, 1); assert.equal(fixture.streamWrites.length, 1);
    assert.equal(fixture.stoppedWriter, 0); assert.equal(fixture.stoppedNative, 0);
    await session.report(config.id, 'camera-restored'); assert.equal(session.state.error, undefined);
    assert.equal(session.state.phase, 'broadcast');
  } finally { await session.stop(); }
});
test('renderer fatal errors retain their stage and do not become a successful user stop', async () => {
  const fixture = await liveFixture(), { session } = fixture;
  const config = await session.start(options);
  await session.report(config.id, 'renderer-compose');
  assert.equal(session.state.status, 'error'); assert.match(session.state.error!, /合成失败/);
  assert.equal(fixture.stoppedNative, 1);
  assert.equal(fixture.diagnostics.find(row => row.scope === 'live.failure')?.detail?.stage, 'renderer-compose');
  assert.equal(fixture.diagnostics.find(row => row.scope === 'live.stopped')?.detail?.reason, 'failure');
});
test('native capture failure remains fatal and records the actual failure before cleanup', async () => {
  const fixture = await liveFixture(); await fixture.session.start(options);
  fixture.native?.onLiveError?.('Owned capture disconnected'); await fixture.session.stop();
  assert.equal(fixture.session.state.status, 'error');
  const error = fixture.diagnostics.find(row => row.scope === 'live.failure');
  assert.equal(error?.error, 'Owned capture disconnected'); assert.equal(error?.detail?.stage, 'native');
});
test('unknown reports and stale session reports cannot stop a current broadcast or log arbitrary data', async () => {
  const fixture = await liveFixture(); const first = await fixture.session.start(options);
  const before = fixture.diagnostics.length;
  assert.throws(() => fixture.session.report(first.id, 'rtmp://secret.invalid/credential'), /报告无效/);
  assert.equal(fixture.diagnostics.length, before);
  await fixture.session.stop(); const current = await fixture.session.start(options);
  try {
    assert.throws(() => fixture.session.report(first.id, 'renderer-compose'), /会话已结束/);
    assert.equal(fixture.session.state.id, current.id); assert.equal(fixture.session.state.status, 'live');
  } finally { await fixture.session.stop(); }
});
test('camera recovery does not erase an independent output error', async () => {
  const fixture = await liveFixture(); const config = await fixture.session.start(options);
  try {
    await fixture.session.pull(config.id); await fixture.session.push(config.id, new ArrayBuffer(config.width * config.height * 4));
    await fixture.session.broadcast(config.id); fixture.streamFailed?.(new Error('Owned output failure'));
    await fixture.session.report(config.id, 'camera-unavailable'); await fixture.session.report(config.id, 'camera-restored');
    assert.equal(fixture.session.state.error, 'Owned output failure');
  } finally { await fixture.session.stop(); }
});
