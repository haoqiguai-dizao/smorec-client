import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { decodingFixture, decodingProject } from './fixtures/export-decoding';

const signal = () => new AbortController().signal;
const pixelTime = (canvas: object | undefined) => (canvas as { time: number } | undefined)?.time;

test('one-frame lookahead overlaps consumer work without overwriting the current pooled canvases', async () => {
  const fixture = await decodingFixture(), project = decodingProject();
  const iterator = fixture.decodeFrames(project, 4, 1, signal());
  for (let index = 0; index < 4; index++) {
    const result = await iterator.next();
    assert.equal(result.done, false);
    if (result.done) throw new Error('Unexpected end');
    const current = result.value, identity = fixture.mediaFrameIdentity(current.canvas!);
    await setImmediate(); // Let the speculative read finish while the consumer retains this frame.
    assert.equal(fixture.state.requested.length, Math.min(index + 2, 4) * 2, 'At most one output frame ahead');
    assert.equal(pixelTime(current.canvas), index);
    assert.equal(pixelTime(current.webcam), index);
    assert.equal(fixture.mediaFrameIdentity(current.canvas!), identity, 'Lookahead must not restamp a retained canvas');
    assert.equal(current.index, index);
  }
  assert.equal((await iterator.next()).done, true);
  assert.deepEqual(fixture.state.pools, [2, 2]);
  assert.deepEqual(fixture.state.disposed.sort(), ['camera.mp4', 'screen.mp4']);
  assert.deepEqual(fixture.state.returned.sort(), ['camera.mp4', 'screen.mp4']);
});

test('hidden tracks make sparse requests and resume at source time across a trim and a composition cut', async () => {
  const fixture = await decodingFixture(), project = decodingProject();
  project.clips = [{ id: 'first', start: 1, end: 3 }, { id: 'second', start: 7, end: 9 }];
  project.camera!.offset = .25;
  project.compositions = [
    { id: 'hidden', start: 2, end: 3, screen: 'hidden', camera: { visible: false } },
    { id: 'background', start: 7, end: 8, screen: 'background', camera: { visible: true } },
  ];
  const results = [];
  for await (const frame of fixture.decodeFrames(project, 4, 1, signal())) {
    results.push({ sourceTime: frame.sourceTime, screen: pixelTime(frame.canvas), camera: pixelTime(frame.webcam) });
  }
  assert.deepEqual(results, [
    { sourceTime: 1, screen: 1, camera: 1.25 },
    { sourceTime: 2, screen: undefined, camera: undefined },
    { sourceTime: 7, screen: undefined, camera: 7.25 },
    { sourceTime: 8, screen: 8, camera: 8.25 },
  ]);
  assert.deepEqual(fixture.state.requested.filter(row => row.track === 'screen.mp4').map(row => row.time), [1, 8]);
  assert.deepEqual(fixture.state.requested.filter(row => row.track === 'camera.mp4').map(row => row.time), [1.25, 7.25, 8.25]);
});

test('all-presenter export never opens screen input; disabled presenter never opens either input', async () => {
  for (const enabled of [true, false]) {
    const fixture = await decodingFixture(), project = decodingProject();
    project.camera = { ...project.camera!, enabled, mode: 'presenter' };
    let count = 0;
    for await (const frame of fixture.decodeFrames(project, 3, 1, signal())) {
      assert.equal(frame.canvas, undefined);
      assert.equal(Boolean(frame.webcam), enabled); count++;
    }
    assert.equal(count, 3, 'Black presenter frames must still be emitted');
    assert.deepEqual(fixture.state.opened, enabled ? ['camera.mp4'] : []);
  }
});

test('locally enabled camera opens despite its master switch, with no requests outside the local interval', async () => {
  const fixture = await decodingFixture(), project = decodingProject();
  project.camera!.enabled = false;
  project.compositions = [{ id: 'local', start: 1, end: 2, screen: 'recording', camera: { visible: true } }];
  const visible = [];
  for await (const frame of fixture.decodeFrames(project, 3, 1, signal())) visible.push(Boolean(frame.webcam));
  assert.deepEqual(visible, [false, true, false]);
  assert.deepEqual(fixture.state.requested.filter(row => row.track === 'camera.mp4').map(row => row.time), [1]);
});

test('VFR/repeated frames preserve decoded identity while output indices and timestamps advance', async () => {
  const fixture = await decodingFixture({ sourceFps: 30 }), identities = [];
  for await (const frame of fixture.decodeFrames(decodingProject(), 4, 60, signal())) {
    identities.push({ index: frame.index, sourceTime: frame.sourceTime, identity: fixture.mediaFrameIdentity(frame.webcam!) });
  }
  assert.deepEqual(identities.map(frame => frame.sourceTime), [0, 1 / 60, 2 / 60, 3 / 60]);
  assert.deepEqual(identities.map(frame => frame.identity?.time), [0, 0, 1 / 30, 1 / 30]);
  assert.equal(identities[0].identity!.token, identities[3].identity!.token);
});

test('camera offsets retain the existing start/end availability and screen tail holds its last frame', async () => {
  const fixture = await decodingFixture({ last: 2 }), project = decodingProject();
  project.camera!.offset = -1;
  const observed = [];
  for await (const frame of fixture.decodeFrames(project, 5, 1, signal())) {
    observed.push({ screen: pixelTime(frame.canvas), camera: pixelTime(frame.webcam) });
  }
  assert.deepEqual(observed, [
    { screen: 0, camera: undefined }, { screen: 1, camera: 0 },
    { screen: 1.999999, camera: 1 }, { screen: 1.999999, camera: 1.999999 },
    { screen: 1.999999, camera: undefined },
  ]);
});

test('cancellation releases both inputs without waiting for a stuck lookahead', { timeout: 3000 }, async () => {
  const controller = new AbortController();
  const fixture = await decodingFixture({ beforeFrame: async (_track, time) => { if (time === 1) await new Promise(() => {}); } });
  const iterator = fixture.decodeFrames(decodingProject(), 3, 1, controller.signal);
  assert.equal((await iterator.next()).done, false);
  await setImmediate(); controller.abort();
  await assert.rejects(iterator.next(), { name: 'AbortError' });
  assert.deepEqual(fixture.state.disposed.sort(), ['camera.mp4', 'screen.mp4']);
});

test('early consumer exit also releases inputs without waiting for a stuck lookahead', { timeout: 3000 }, async () => {
  const fixture = await decodingFixture({ beforeFrame: async (_track, time) => { if (time === 1) await new Promise(() => {}); } });
  const iterator = fixture.decodeFrames(decodingProject(), 3, 1, signal());
  await iterator.next(); await setImmediate();
  assert.equal((await iterator.return()).done, true);
  assert.deepEqual(fixture.state.disposed.sort(), ['camera.mp4', 'screen.mp4']);
});

test('a lookahead error is observed immediately and propagated on consumption without dropping the current frame', async () => {
  const fixture = await decodingFixture({ beforeFrame: async (_track, time) => { if (time === 1) throw new Error('decode failed'); } });
  const iterator = fixture.decodeFrames(decodingProject(), 3, 1, signal());
  const first = await iterator.next();
  await setImmediate(); // Node's test runner also fails on any unhandled rejection here.
  assert.equal(first.done, false);
  assert.equal(pixelTime(first.value?.canvas), 0);
  await assert.rejects(iterator.next(), /decode failed/);
  assert.deepEqual(fixture.state.disposed.sort(), ['camera.mp4', 'screen.mp4']);
});

test('a required track ending early fails instead of silently rendering a blank frame', async () => {
  const fixture = await decodingFixture({ endAt: 1 });
  const iterator = fixture.decodeFrames(decodingProject(), 3, 1, signal());
  await iterator.next();
  await assert.rejects(iterator.next(), /视频提前结束/);
});

test('an already canceled export and a zero-frame iterator open no inputs', async () => {
  const fixture = await decodingFixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(fixture.decodeFrames(decodingProject(), 3, 1, controller.signal).next(), { name: 'AbortError' });
  assert.equal((await fixture.decodeFrames(decodingProject(), 0, 1, signal()).next()).done, true);
  assert.deepEqual(fixture.state.opened, []);
});

test('prepares the next frame while the consumer keeps current pixels, with only one preparation in flight', async () => {
  const fixture = await decodingFixture(), prepared: number[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const iterator = fixture.decodeFrames(decodingProject(), 3, 1, signal(), async frame => {
    prepared.push(frame.index);
    if (frame.index === 1) await held;
  });
  const first = await iterator.next();
  await setImmediate();
  assert.deepEqual(prepared, [0, 1]);
  assert.equal(pixelTime(first.value?.webcam), 0);
  assert.equal(fixture.state.requested.length, 4);
  release();
  assert.equal((await iterator.next()).value?.index, 1);
  assert.equal((await iterator.next()).value?.index, 2);
  assert.equal((await iterator.next()).done, true);
});

test('cancel during speculative face preparation releases decoder inputs promptly', { timeout: 3000 }, async () => {
  const fixture = await decodingFixture(), controller = new AbortController();
  const iterator = fixture.decodeFrames(decodingProject(), 3, 1, controller.signal, async frame => {
    if (frame.index === 1) await new Promise(() => {});
  });
  await iterator.next(); await setImmediate(); controller.abort();
  await assert.rejects(iterator.next(), { name: 'AbortError' });
  assert.deepEqual(fixture.state.disposed.sort(), ['camera.mp4', 'screen.mp4']);
});

test('a speculative face error preserves the current frame and rejects its own output frame', async () => {
  const fixture = await decodingFixture();
  const iterator = fixture.decodeFrames(decodingProject(), 3, 1, signal(), async frame => {
    if (frame.index === 1) throw new Error('face failed');
  });
  assert.equal((await iterator.next()).value?.index, 0);
  await setImmediate();
  await assert.rejects(iterator.next(), /face failed/);
  assert.deepEqual(fixture.state.disposed.sort(), ['camera.mp4', 'screen.mp4']);
});

test('three-frame lookahead is bounded and retains current pixels when preparations complete out of order', async () => {
  const fixture = await decodingFixture(), order: number[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const iterator = fixture.decodeFrames(decodingProject(), 7, 1, signal(), async frame => {
    if (frame.index === 0) await held;
    order.push(frame.index);
  }, 3);
  const pending = iterator.next(); await setImmediate();
  assert.deepEqual(order, [1, 2], 'Other bounded preparations may finish before the first');
  assert.equal(fixture.state.requested.length, 6);
  release(); const first = await pending; await setImmediate();
  assert.equal(pixelTime(first.value?.canvas), 0); assert.equal(fixture.state.requested.length, 8);
  const emitted = [first.value!.index];
  for await (const frame of iterator) {
    await setImmediate();
    assert.equal(pixelTime(frame.canvas), frame.index); assert.equal(pixelTime(frame.webcam), frame.index);
    assert.ok(fixture.state.requested.length <= Math.min(7, frame.index + 4) * 2);
    emitted.push(frame.index);
  }
  assert.deepEqual(emitted, [0, 1, 2, 3, 4, 5, 6]); assert.deepEqual(fixture.state.pools, [4, 4]);
});
