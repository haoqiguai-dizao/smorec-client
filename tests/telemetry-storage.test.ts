import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { replaceTelemetryState } from '../electron/services/telemetry/atomic-replace';
import { emptyState, TelemetryStore } from '../electron/services/telemetry/store';

const failure = (code: string) => Object.assign(new Error(`Synthetic ${code}`), { code });

test('atomic replacement retries only transient file denial and uses the same source and destination', async () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
    const calls: string[][] = [], waits: number[] = [];
    await replaceTelemetryState('state.tmp', 'state.json', {
      rename: async (...args) => { calls.push(args); if (calls.length <= 2) throw failure(code); },
      wait: async milliseconds => { waits.push(milliseconds); },
    });
    assert.deepEqual(calls, Array.from({ length: 3 }, () => ['state.tmp', 'state.json']));
    assert.deepEqual(waits, [25, 50]);
  }
});

test('atomic replacement rejects the original error after its bounded retry budget or immediately for permanent errors', async () => {
  for (const code of ['EPERM', 'EBUSY', 'EACCES', 'ENOSPC', 'ENOENT', 'EROFS', 'EIO']) {
    const error = failure(code), waits: number[] = []; let calls = 0;
    await assert.rejects(replaceTelemetryState('state.tmp', 'state.json', {
      rename: async () => { calls++; throw error; }, wait: async milliseconds => { waits.push(milliseconds); },
    }), actual => actual === error);
    const transient = ['EPERM', 'EBUSY', 'EACCES'].includes(code);
    assert.equal(calls, transient ? 7 : 1);
    assert.deepEqual(waits, transient ? [25, 50, 100, 200, 400, 800] : []);
  }
});

test('a temporarily locked state keeps the last complete snapshot until replacement succeeds, then serializes the next write', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smorec-telemetry-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new TelemetryStore(directory), original = fs.rename;
  const before = emptyState(); await store.write(before);
  const enabled = { ...before, consent: 'enabled' as const, installation_id: randomUUID() };
  const disabled = { ...enabled, consent: 'disabled' as const };
  let attempts = 0, entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const unlocked = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(fs, 'rename', async (from: string, to: string) => {
    if (to === path.join(directory, 'telemetry-state.json') && ++attempts === 1) {
      entered(); await unlocked; throw failure('EPERM');
    }
    return original(from, to);
  });
  const first = store.write(enabled), second = store.write(disabled);
  await started;
  assert.equal((await new TelemetryStore(directory).read()).consent, 'unselected');
  release(); await first; await second;
  assert.ok(attempts >= 3);
  assert.equal((await store.read()).consent, 'disabled');
  assert.deepEqual(await fs.readdir(directory), ['telemetry-state.json']);
});

test('permanent replacement failure preserves the old state and does not poison later writes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smorec-telemetry-storage-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new TelemetryStore(directory), original = fs.rename, before = emptyState();
  await store.write(before);
  const error = failure('EROFS'); let reject = true;
  t.mock.method(fs, 'rename', async (from: string, to: string) => {
    if (reject && to === path.join(directory, 'telemetry-state.json')) throw error;
    return original(from, to);
  });
  const after = { ...before, consent: 'disabled' as const };
  await assert.rejects(store.write(after), actual => actual === error);
  assert.equal((await store.read()).consent, 'unselected');
  reject = false; await store.write(after);
  assert.equal((await store.read()).consent, 'disabled');
});
