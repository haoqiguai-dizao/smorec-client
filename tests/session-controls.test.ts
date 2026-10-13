import test from 'node:test';
import assert from 'node:assert/strict';
import { liveFixture } from './live-session-harness';
import { DemoController } from '../electron/services/demo/controller';
import { LiveBoardPlayback } from '../src/services/live/whiteboard';
import { boardAt } from '../shared/whiteboard/model';
import { boardImage, loadBoardImage, releaseBoardImages } from '../src/services/whiteboard-images';

const options = { sourceId: 'screen:fixture', output: 'stream', streamProfileId: 'e4b7a7aa-3026-454f-8990-b68544b6c0af', systemAudio: false, microphone: false };
test('enable previously absent live audio, mute and restore without replacing capture, output or PCM clock', async () => {
  const f = await liveFixture(); const config = await f.session.start(options);
  try {
    assert.deepEqual(f.session.state.audio, { system: false, microphone: false });
    await f.session.setAudio(config.id, 'microphone', true);
    await f.session.setAudio(config.id, 'system', true);
    await f.session.setAudio(config.id, 'microphone', false);
    await f.session.setAudio(config.id, 'microphone', true);
    assert.deepEqual(f.session.state.audio, { system: true, microphone: true });
    await f.session.pull(config.id); await f.session.push(config.id, new ArrayBuffer(1));
    assert.equal(f.streamAudio[0].time, 9.8); assert.equal(f.streamWrites[0].time, 10);
    assert.equal(f.prepared, 1); assert.equal(f.stoppedWriter, 0); assert.equal(f.stoppedNative, 0);
    assert.equal(f.audioUpdates.length, 4);
    await assert.rejects(f.session.setAudio('old-session', 'microphone', false), /已结束/);
    await assert.rejects(f.session.setAudio(config.id, 'other', true), /参数/);
  } finally { await f.session.stop(); }
});
test('failed or concurrent audio switch retains acknowledged channel state and a running output', async () => {
  const f = await liveFixture(); const config = await f.session.start(options);
  try {
    let release!: () => void;
    f.audioHook = () => new Promise(resolve => { release = resolve; });
    const pending = f.session.setAudio(config.id, 'microphone', true);
    await assert.rejects(f.session.setAudio(config.id, 'system', true), /切换/);
    assert.equal(f.session.state.audio?.microphone, false);
    release(); await pending;
    f.audioHook = async () => { throw new Error('device unavailable'); };
    await assert.rejects(f.session.setAudio(config.id, 'microphone', false), /device unavailable/);
    assert.equal(f.session.state.audio?.microphone, true); assert.equal(f.session.state.status, 'live');
    assert.equal(f.stoppedWriter, 0);
  } finally { await f.session.stop(); }
});
test('first demo entry during ordinary live capture retains the same native/output sessions', async () => {
  const f = await liveFixture(); const config = await f.session.start(options);
  try {
    await f.session.setDemoVisibility(true); assert.equal((await f.session.pull(config.id)).demoVisible, true);
    await f.session.setDemoVisibility(false); assert.equal((await f.session.pull(config.id)).demoVisible, false);
    assert.deepEqual(f.demoUpdates, [{ visible: true }, { visible: false }]);
    assert.equal(f.prepared, 1); assert.equal(f.stoppedWriter, 0); assert.equal(f.stoppedNative, 0);
  } finally { await f.session.stop(); }
});
test('demo mode can first enter and exit in an active capture; failure and stale replies do not enable it', async () => {
  let reject = false, complete: (() => void) | undefined;
  const controller = new DemoController({ apply: async () => {
    if (reject) throw new Error('filter rejected');
    if (complete === undefined) return;
    await new Promise<void>(resolve => { complete = resolve; });
  }, windows: () => {}, restore: () => {}, changed: () => {} });
  controller.begin('screen:1'); controller.started();
  await controller.setEnabled(true); assert.equal(controller.state.visible, true);
  await controller.setEnabled(false); assert.equal(controller.state.active, true);
  reject = true; await assert.rejects(controller.setEnabled(true), /filter rejected/);
  assert.equal(controller.state.enabled, false); assert.equal(controller.state.busy, false);
  reject = false; complete = () => {};
  const pending = controller.setEnabled(true); controller.end(); complete(); await pending;
  assert.equal(controller.state.enabled, false); assert.equal(controller.state.active, false);
});
test('live board packets incrementally update a stable playback, detect gaps and reset by session', () => {
  const player = new LiveBoardPlayback();
  player.ingest({ session: 'first', from: 0, events: [{ t: 1, action: { kind: 'text', id: 'note', color: '#20242c', size: 20, x: 1, y: 2, text: '直播白板' } }] });
  const recording = player.recording;
  assert.equal(boardAt(recording, 1).items.length, 1);
  player.ingest({ session: 'first', from: 1, events: [{ t: 2, action: { kind: 'clear' } }] });
  assert.equal(player.recording, recording); assert.equal(boardAt(recording, 2).items.length, 0);
  assert.throws(() => player.ingest({ session: 'first', from: 4, events: [] }), /中断/);
  player.ingest({ session: 'second', from: 0, events: [] });
  assert.equal(player.recording.events.length, 0);
  assert.equal(player.recording.interfaceCapture, 'screen');
  assert.equal(player.recording.separateCanvas, undefined);
});

test('retiring live image scopes rejects late cache writes and preserves other scopes', async () => {
  const original = globalThis.Image;
  const requests: FakeImage[] = [];
  class FakeImage { src = ''; crossOrigin = ''; onload?: () => void; onerror?: () => void;
    constructor() { requests.push(this); } }
  globalThis.Image = FakeImage as unknown as typeof Image;
  try {
    const pending = loadBoardImage('live-cache-test', 'asset');
    releaseBoardImages('live-cache-test'); requests[0].onload!(); await pending;
    assert.equal(boardImage('live-cache-test', 'asset'), undefined);
    const other = loadBoardImage('other-cache-test', 'asset'); requests[1].onload!(); await other;
    releaseBoardImages('live-cache-test'); assert.ok(boardImage('other-cache-test', 'asset'));
  } finally {
    releaseBoardImages('other-cache-test');
    if (original) globalThis.Image = original; else Reflect.deleteProperty(globalThis, 'Image');
  }
});
