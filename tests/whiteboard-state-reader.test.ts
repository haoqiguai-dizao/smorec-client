import assert from 'node:assert/strict';
import test from 'node:test';
import { WhiteboardStateReader } from '../src/services/whiteboard-state-reader';
import type { BoardSnapshot } from '../shared/whiteboard/types';

const snapshot = (session = 'board'): BoardSnapshot => ({ session, available: true, visible: false, events: [], backdrop: 'white' });
function delayed() {
  let resolve!: (value: BoardSnapshot) => void, reject!: (error: Error) => void;
  const promise = new Promise<BoardSnapshot>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('a delayed content snapshot cannot erase the new opening confirmation token', async () => {
  const pending = delayed(), reader = new WhiteboardStateReader(() => pending.promise);
  const reading = reader.read();
  reader.observe({ ...snapshot(), visible: true, opening: 'new-opening' });
  pending.resolve(snapshot());
  const result = await reading;
  assert.equal(result?.state.opening, 'new-opening'); assert.equal(result?.state.visible, true);
  assert.deepEqual(result?.snapshot.events, []);
});

test('continuous recording state pushes share one pending hydration instead of starving readiness', async () => {
  const pending = delayed(); let requests = 0;
  const reader = new WhiteboardStateReader(() => { requests++; return pending.promise; });
  reader.observe(snapshot());
  const first = reader.read(), repeated = [];
  for (let index = 0; index < 30; index++) {
    reader.observe({ ...snapshot(), visible: true, opening: 'opening-' + index });
    repeated.push(reader.read());
  }
  assert.equal(requests, 1); assert.ok(repeated.every(request => request === first));
  pending.resolve(snapshot());
  assert.equal((await first)?.state.opening, 'opening-29');
});

test('a snapshot received after closing cannot resurrect the prior visible board', async () => {
  const pending = delayed(), reader = new WhiteboardStateReader(() => pending.promise);
  const reading = reader.read(); reader.observe(snapshot());
  pending.resolve({ ...snapshot(), visible: true, opening: 'retired' });
  const result = await reading;
  assert.equal(result?.state.visible, false); assert.equal(result?.state.opening, undefined);
});

test('old sessions, superseded responses and failures cannot affect a reopened board', async () => {
  const old = delayed(), next = delayed(); let call = 0;
  const reader = new WhiteboardStateReader(() => call++ === 0 ? old.promise : next.promise);
  const first = reader.read(); reader.observe({ ...snapshot('new'), opening: 'new-opening' });
  const second = reader.read(); next.resolve(snapshot('new'));
  assert.equal((await second)?.state.opening, 'new-opening');
  old.reject(new Error('retired request')); assert.equal(await first, undefined);
  const stale = new WhiteboardStateReader(async () => snapshot('old'));
  stale.observe(snapshot('new')); assert.equal(await stale.read(), undefined);
});

test('unmounting rejects stale hydration without suppressing an active request failure', async () => {
  const pending = delayed(), reader = new WhiteboardStateReader(() => pending.promise);
  const reading = reader.read(); reader.dispose(); pending.resolve(snapshot());
  assert.equal(await reading, undefined);
  const active = new WhiteboardStateReader(async () => { throw new Error('current failure'); });
  await assert.rejects(active.read(), /current failure/);
});
