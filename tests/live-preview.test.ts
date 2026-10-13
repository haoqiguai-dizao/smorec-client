import test from 'node:test';
import assert from 'node:assert/strict';
import { liveFixture } from './live-session-harness';

const options = { sourceId: 'screen:fixture', output: 'stream', preview: true,
  streamProfileId: 'e4b7a7aa-3026-454f-8990-b68544b6c0af', systemAudio: true };
test('local preview opens no platform output and cannot start broadcasting without a composed frame', async () => {
  const f = await liveFixture(); f.deviceInstalled = false;
  const config = await f.session.start(options);
  try {
    assert.equal(f.session.state.phase, 'preview'); assert.equal(f.streamChanged, undefined);
    await assert.rejects(f.session.broadcast(config.id), /预览画面/);
    await f.session.pull(config.id); await f.session.push(config.id, new ArrayBuffer(config.width * config.height * 4));
    assert.equal(f.streamWrites.length, 0); assert.equal(f.streamAudio.length, 0);
    await f.session.broadcast(config.id);
    assert.equal(f.session.state.phase, 'broadcast');
    await f.session.pull(config.id); await f.session.push(config.id, new ArrayBuffer(config.width * config.height * 4));
    assert.equal(f.streamWrites.length, 1); assert.equal(f.streamAudio.length, 1);
  } finally { await f.session.stop(); }
});
test('platform rejection returns to the same local preview; retries preserve capture and ignore retired callbacks', async () => {
  const f = await liveFixture(), config = await f.session.start(options);
  try {
    await f.session.pull(config.id); await f.session.push(config.id, new ArrayBuffer(config.width * config.height * 4));
    await f.session.broadcast(config.id);
    const changed = f.streamChanged;
    f.streamFailed?.(new Error('密钥已失效'));
    assert.equal(f.session.state.status, 'live'); assert.equal(f.session.state.phase, 'preview');
    assert.equal(f.session.state.id, config.id); assert.equal(f.stoppedNative, 0);
    await f.session.broadcast(config.id);
    changed?.({ status: 'failed', attempt: 0, frames: 0, dropped: 0, bitrate: 0, error: 'old' });
    assert.equal(f.session.state.phase, 'broadcast'); assert.notEqual(f.session.state.connection?.error, 'old');
  } finally { await f.session.stop(); }
  assert.equal(f.stoppedWriter, 2); assert.equal(f.stoppedNative, 1);
});
test('cancelling a connection in progress cannot reopen output after stop', async () => {
  const f = await liveFixture(), config = await f.session.start(options);
  await f.session.pull(config.id); await f.session.push(config.id, new ArrayBuffer(config.width * config.height * 4));
  let release!: () => void;
  f.writerHook = () => new Promise<void>(resolve => { release = resolve; });
  const connecting = f.session.broadcast(config.id);
  const rejected = assert.rejects(connecting, /会话已结束/);
  const stopping = f.session.stop(); release(); await rejected; await stopping;
  assert.equal(f.session.state.status, 'idle'); assert.equal(f.stoppedNative, 1);
});
