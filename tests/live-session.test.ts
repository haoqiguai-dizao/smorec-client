import assert from 'node:assert/strict';
import test from 'node:test';
import { liveFixture } from './live-session-harness';
import { parseLiveOptions } from '../electron/services/live/validation';

const options = { sourceId: 'screen:fixture' };

test('explicit panorama mode preserves the activity opt-out through native and renderer configuration', async () => {
  assert.throws(() => parseLiveOptions({ ...options, inputRecording: 'false' }));
  const fixture = await liveFixture();
  try {
    const config = await fixture.session.start({ ...options, inputRecording: false });
    assert.equal(fixture.nativeOptions?.inputRecording, false);
    assert.equal(config.inputRecording, false);
  } finally { await fixture.session.stop(); }
});

test('live demo switching keeps the writer and clock, discards crossing frames and resumes composition layers', async () => {
  const fixture = await liveFixture(); fixture.demo = { captureOwnApp: true, ownAppVisible: true };
  const config = await fixture.session.start(options);
  try {
    assert.equal((await fixture.session.pull(config.id)).demoVisible, true);
    let finish!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let pulls = 0;
    fixture.pullHook = async () => {
      if (++pulls === 1) { entered(); await new Promise<void>(resolve => { finish = resolve; }); }
      return 10 + pulls;
    };
    const pending = fixture.session.pull(config.id); await started;
    await fixture.session.setDemoVisibility(false); finish();
    const next = await pending;
    assert.equal(next.demoVisible, false); assert.equal(pulls, 2);
    assert.equal(next.time, 12); assert.equal(fixture.session.state.id, config.id);
    assert.equal(fixture.stoppedWriter, 0); assert.equal(fixture.stoppedNative, 0); assert.equal(fixture.closedFrames, 0);
    await fixture.session.setDemoVisibility(true);
    assert.equal((await fixture.session.pull(config.id)).demoVisible, true);
  } finally { await fixture.session.stop(); }
});

test('live settings require all crop fields, reject extra fields and detach the crop', () => {
  for (const crop of [{}, [], null, { x: 0, y: 0, width: 100 }, { x: 0, y: 0, width: 100, height: 50, text: 'extra' },
    { x: 0, y: 0, width: NaN, height: 50 }, { x: 0, y: 0, width: 100.5, height: 50 }, { x: -1, y: 0, width: 100, height: 50 }]) {
    assert.throws(() => parseLiveOptions({ ...options, crop }));
  }
  const crop = { x: 0, y: 0, width: 100, height: 50 };
  const parsed = parseLiveOptions({ ...options, crop });
  crop.width = 200; assert.equal(parsed.crop?.width, 100);
});

test('invalid or busy starts do not restore UI that they never prepared', async () => {
  const fixture = await liveFixture();
  await assert.rejects(fixture.session.start({ ...options, crop: {} }));
  assert.equal(fixture.prepared, 0); assert.equal(fixture.restored, 0);
  fixture.idle = false;
  await assert.rejects(fixture.session.start(options));
  assert.equal(fixture.prepared, 0); assert.equal(fixture.restored, 0);
});

test('partial preparation failure restores once and keeps the original failure', async () => {
  const fixture = await liveFixture(); fixture.prepareError = new Error('Synthetic prepare failure');
  fixture.restoreError = new Error('Synthetic restore failure');
  await assert.rejects(fixture.session.start(options), /Synthetic prepare failure/);
  assert.equal(fixture.restored, 1); assert.equal(fixture.session.state.status, 'error');
});

test('native startup errors cannot be ignored and published as a live session', async () => {
  const fixture = await liveFixture();
  fixture.nativeHook = async native => { native.onLiveError?.('Synthetic startup capture failure'); return { width: 640, height: 360 }; };
  await assert.rejects(fixture.session.start(options), /Synthetic startup capture failure/);
  assert.ok(!fixture.states.some(state => state.status === 'live'));
  assert.equal(fixture.stoppedNative, 1); assert.equal(fixture.restored, 1);
});

test('stop during preparation prevents native capture from starting afterward', async () => {
  const fixture = await liveFixture();
  let release!: () => void;
  const entered = new Promise<void>(resolve => {
    fixture.prepareHook = () => { resolve(); return new Promise<void>(ready => { release = ready; }); };
  });
  const starting = fixture.session.start(options); const rejected = assert.rejects(starting, /直播启动已取消/);
  await entered;
  const stopping = fixture.session.stop(); release();
  await rejected; await stopping;
  assert.equal(fixture.native, undefined); assert.equal(fixture.restored, 1);
  assert.ok(!fixture.states.some(state => state.status === 'live'));
});

test('writer startup failure after native success closes every allocated resource', async () => {
  const fixture = await liveFixture();
  fixture.writerHook = async failed => { failed(new Error('Synthetic writer failure')); };
  await assert.rejects(fixture.session.start(options), /Synthetic writer failure/);
  assert.equal(fixture.stoppedWriter, 1); assert.equal(fixture.stoppedNative, 1); assert.equal(fixture.restored, 1);
});

test('stop cleans native capture even when the virtual writer throws, and is idempotent', async () => {
  const fixture = await liveFixture(); await fixture.session.start(options);
  fixture.writerStopError = new Error('Synthetic cleanup failure');
  await Promise.all([fixture.session.stop(), fixture.session.stop()]);
  assert.equal(fixture.stoppedWriter, 1); assert.equal(fixture.stoppedNative, 1); assert.equal(fixture.restored, 1);
  assert.equal(fixture.session.state.status, 'idle');
});

test('input overflow resets at the newest activity timestamp even without cursor samples', async () => {
  const fixture = await liveFixture(); const config = await fixture.session.start(options);
  try {
    fixture.native?.onLiveInput?.(Array.from({ length: 257 }, (_, index) => ({ activity: { t: index / 10 + 1, kind: 'typing' } })));
    const frame = await fixture.session.pull(config.id);
    assert.deepEqual(frame.input, [{ activity: { t: 26.6, kind: 'reset' } }]);
  } finally { await fixture.session.stop(); }
});

test('frame transport failure ends the session and stale IDs cannot stop another session', async () => {
  const fixture = await liveFixture(); const config = await fixture.session.start(options);
  await assert.rejects(fixture.session.pull('other-session'), /直播会话已结束/);
  assert.equal(fixture.session.state.status, 'live');
  fixture.pullError = new Error('Synthetic pipe failure');
  await assert.rejects(fixture.session.pull(config.id), /Synthetic pipe failure/);
  await fixture.session.stop();
  assert.equal(fixture.session.state.status, 'error'); assert.equal(fixture.restored, 1);
});


test('live exclusions update the native session without replacing the output or accepting stale IDs', async () => {
  const fixture = await liveFixture(); const config = await fixture.session.start(options);
  try {
    await fixture.session.setExcludedApplications(config.id, ['C:/Apps/Browser.exe', 'c:/apps/browser.EXE']);
    assert.deepEqual(fixture.exclusionUpdates, [{ excludedApplications: ['c:\\apps\\browser.EXE'] }]);
    assert.equal(fixture.session.state.id, config.id);
    assert.equal(fixture.stoppedWriter, 0); assert.equal(fixture.stoppedNative, 0); assert.equal(fixture.closedFrames, 0);
    await assert.rejects(fixture.session.setExcludedApplications('stale', []), /会话已结束/);
    await assert.rejects(fixture.session.setExcludedApplications(config.id, ['browser.exe']), /列表无效/);
    assert.equal(fixture.exclusionUpdates.length, 1);
    fixture.exclusionHook = async () => { throw new Error('apply failed'); };
    await assert.rejects(fixture.session.setExcludedApplications(config.id, []), /apply failed/);
    assert.equal(fixture.session.state.status, 'live');
    fixture.exclusionHook = undefined;
    await fixture.session.setExcludedApplications(config.id, []);
    assert.equal(fixture.exclusionUpdates.length, 3);
  } finally { await fixture.session.stop(); }
});

test('exclusion changes serialize and ignore input from the retiring capture', async () => {
  const fixture = await liveFixture(); const config = await fixture.session.start(options);
  let finish: () => void = () => {};
  fixture.exclusionHook = () => new Promise(resolve => { finish = resolve; });
  try {
    const changing = fixture.session.setExcludedApplications(config.id, []);
    await assert.rejects(fixture.session.setExcludedApplications(config.id, []), /正在更新/);
    fixture.native?.onLiveInput?.([{ activity: { t: 4, kind: 'typing' } }]);
    const frame = await fixture.session.pull(config.id);
    assert.ok(frame.input.every(event => event.activity?.kind === 'reset'));
    finish(); await changing;
  } finally { finish(); await fixture.session.stop(); }
});
