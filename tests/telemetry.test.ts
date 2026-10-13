import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTelemetry, type TelemetryOptions } from '../electron/services/telemetry';
import { TelemetryStore } from '../electron/services/telemetry/store';
import { MAX_QUEUE_EVENTS, UUID } from '../electron/services/telemetry/validation';
import type { TelemetryBatch, TelemetryEvent, TelemetryProperties } from '../shared/telemetry-types';

async function fixture(t: { after(callback: () => Promise<void>): void }) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smorec-telemetry-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const batches: TelemetryBatch[] = [];
  const options: TelemetryOptions = { directory, endpoint: 'https://telemetry.invalid/api/events/batch', version: '0.9.10',
    channel: 'stable', platform: 'win32', packaged: true,
    fetch: async (_url, init) => { batches.push(JSON.parse(String(init.body))); return { status: 200 }; } };
  return { directory, options, batches };
}
test('unselected telemetry creates no identifier, queue, file or network traffic; development builds cannot collect', async t => {
  const { directory, options, batches } = await fixture(t);
  const client = createTelemetry(options); await client.start();
  assert.deepEqual(client.preferences(), { consent: 'unselected', enabled: false });
  assert.equal(client.track('recording_start'), false); await client.stop();
  assert.deepEqual(await fs.readdir(directory), []); assert.equal(batches.length, 0);
  const development = createTelemetry({ ...options, packaged: false });
  await development.start(); await development.setEnabled(true);
  assert.equal(development.preferences().enabled, false); assert.equal(development.track('live_start'), false);
  await development.stop(); assert.equal(batches.length, 0);
  const saved = await new TelemetryStore(directory).read(); assert.equal(saved.installation_id, undefined); assert.deepEqual(saved.queue, []);
});
test('explicit consent records first use once, preserves event metadata and emits each session open/close without content', async t => {
  const { directory, options, batches } = await fixture(t);
  const client = createTelemetry(options); await client.start(); await client.setEnabled(true);
  assert.equal(client.track('recording_start'), true);
  assert.equal(client.track('recording_end', { duration_ms: 1234, outcome: 'success' }), true);
  assert.equal(client.track('export_end', { error_code: 'export_failed', outcome: 'failure' }), true);
  assert.equal(client.track('export_end', { error: 'secret path to recording' } as TelemetryProperties), false);
  await client.stop();
  assert.equal(batches.length, 1); assert.match(batches[0].installation_id, UUID);
  assert.deepEqual(batches[0].events.map(event => event.name), ['app_first_open', 'app_open', 'recording_start', 'recording_end', 'export_end', 'app_close']);
  assert.ok(batches[0].events.every(event => UUID.test(event.event_id) && event.app_version === '0.9.10'));
  assert.equal(JSON.stringify(batches).includes('secret path'), false);
  const restored = createTelemetry(options); await restored.start(); await restored.stop();
  assert.equal(batches[1].installation_id, batches[0].installation_id);
  assert.deepEqual(batches[1].events.map(event => event.name), ['app_open', 'app_close']);
  await restored.setEnabled(false); await restored.start(); await restored.setEnabled(true); await restored.stop();
  assert.equal(batches[2].installation_id, batches[0].installation_id);
  assert.deepEqual(batches[2].events.map(event => event.name), ['app_open', 'app_close']);
  assert.deepEqual((await new TelemetryStore(directory).read()).queue, []);
});
test('offline retries retain identical event IDs across restart and batches never exceed fifty', async t => {
  const { directory, options, batches } = await fixture(t);
  const failed = createTelemetry({ ...options, fetch: async (_url, init) => { batches.push(JSON.parse(String(init.body))); return { status: 503 }; } });
  await failed.start(); await failed.setEnabled(true); await failed.stop();
  assert.equal(failed.snapshot().retryAttempt, 1);
  const firstIds = batches[0].events.map(event => event.event_id);
  const retry = createTelemetry(options); await retry.start(); await retry.stop();
  assert.deepEqual(batches[1].events.slice(0, firstIds.length).map(event => event.event_id), firstIds);
  const event = (): TelemetryEvent => ({ event_id: randomUUID(), name: 'recording_start', occurred_at: new Date().toISOString(),
    app_version: '0.9.10', channel: 'stable', platform: 'win32', properties: {} });
  await new TelemetryStore(directory).write({ schema_version: 1, consent: 'enabled', installation_id: randomUUID(),
    first_open_recorded: true, queue: Array.from({ length: MAX_QUEUE_EVENTS }, event) });
  let begin!: () => void, acknowledge!: (value: { status: number }) => void, boundedRequests = 0;
  const began = new Promise<void>(resolve => { begin = resolve; });
  const bounded = createTelemetry({ ...options, fetch: async (_url, init) => {
    batches.push(JSON.parse(String(init.body))); begin();
    if (++boundedRequests === 1) return new Promise(resolve => { acknowledge = resolve; });
    return { status: 200 };
  } });
  await bounded.start(); bounded.track('live_start');
  const ending = bounded.stop(); await began; acknowledge({ status: 200 }); await ending;
  assert.equal(batches.at(-1)!.events.length, 50);
  const remaining = (await new TelemetryStore(directory).read()).queue;
  assert.ok(remaining.length <= MAX_QUEUE_EVENTS);
  const accepted = new Set(batches.at(-1)!.events.map(event => event.event_id));
  assert.ok(remaining.every(event => !accepted.has(event.event_id)));
  assert.ok(bounded.snapshot().droppedEvents >= 1 && bounded.snapshot().droppedEvents <= 3);
  await bounded.setEnabled(false);
});
test('a clean stop persists acknowledged queue removal again after one transient storage failure', async t => {
  const { directory, options, batches } = await fixture(t);
  const original = TelemetryStore.prototype.write;
  let failedAck = false;
  t.mock.method(TelemetryStore.prototype, 'write', function(this: TelemetryStore, state: Parameters<TelemetryStore['write']>[0]) {
    if (state.consent === 'enabled' && !state.queue.length && !failedAck) {
      failedAck = true; return Promise.reject(new Error('Synthetic atomic replacement failure'));
    }
    return original.call(this, state);
  });
  const client = createTelemetry(options); await client.start(); await client.setEnabled(true); await client.stop();
  assert.equal(failedAck, true); assert.equal(batches.length, 1);
  assert.equal(client.snapshot().lastError, undefined);
  assert.deepEqual((await new TelemetryStore(directory).read()).queue, []);
});
test('opting out aborts an active request, clears persisted queue, and never replays skipped events', async t => {
  const { directory, options } = await fixture(t);
  let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
  let signal: AbortSignal | undefined, requests = 0;
  const client = createTelemetry({ ...options, fetch: async (_url, init) => {
    requests++; signal = init.signal as AbortSignal; began(); return new Promise(() => {});
  } });
  await client.start(); await client.setEnabled(true);
  const stopping = client.stop(); await started;
  await client.setEnabled(false); await stopping;
  assert.equal(signal?.aborted, true); assert.equal(client.snapshot().queuedEvents, 0);
  const saved = await new TelemetryStore(directory).read(); assert.equal(saved.consent, 'disabled'); assert.deepEqual(saved.queue, []);
  assert.match(saved.installation_id!, UUID);
  await client.start(); assert.equal(client.track('live_start'), false); await client.stop(); assert.equal(requests, 1);
});
test('corrupt consent fails closed, permanent HTTP rejection drops only its batch, and storage failure cannot send', async t => {
  const { directory, options, batches } = await fixture(t);
  await fs.writeFile(path.join(directory, 'telemetry-state.json'), '{"consent":"enabled","queue":["sensitive"]}');
  const corrupted = createTelemetry(options); await corrupted.start(); await corrupted.stop();
  assert.equal(corrupted.preferences().consent, 'unselected'); assert.equal(batches.length, 0);
  const rejected = createTelemetry({ ...options, fetch: async () => ({ status: 409 }) });
  await rejected.start(); await rejected.setEnabled(true); await rejected.stop();
  assert.equal(rejected.snapshot().queuedEvents, 0); assert.equal(rejected.snapshot().lastError, 'rejected');
  const blockingFile = path.join(directory, 'not-a-directory'); await fs.writeFile(blockingFile, 'test');
  const unwritable = createTelemetry({ ...options, directory: blockingFile }); await unwritable.start();
  await assert.rejects(unwritable.setEnabled(true), /无法保存统计设置/); await unwritable.stop();
  assert.equal(batches.length, 0); assert.equal(unwritable.snapshot().lastError, 'storage_unavailable');
});
