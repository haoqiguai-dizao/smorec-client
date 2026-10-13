import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseEvent, parseProperties, retryDelay, validEndpoint, validVersion } from '../electron/services/telemetry/validation';
import { sendBatch } from '../electron/services/telemetry/transport';
import type { TelemetryBatch } from '../shared/telemetry-types';

test('properties accept only explicit numeric and enumeration metadata; free text and wrong event fields are rejected', () => {
  assert.deepEqual(parseProperties('update_result', { outcome: 'failure', error_code: 'update_failed', target_version: '1.2.3-beta.1', duration_ms: 3000 }),
    { outcome: 'failure', error_code: 'update_failed', target_version: '1.2.3-beta.1', duration_ms: 3000 });
  for (const value of [{ duration_ms: -1 }, { duration_ms: 1.1 }, { duration_ms: Infinity }, { duration_ms: '123' },
    { duration_ms: 604800001 }, { outcome: 'secret' }, { error_code: 'D:\\private\\video.mp4' }, { name: 'file' },
    { outcome: { toString: () => 'success', secret: 'content' } }, { target_version: '1.0.0' }]) {
    assert.equal(parseProperties('recording_end', value), undefined);
  }
  assert.equal(parseProperties('app_open', { duration_ms: 1 }), undefined);
  assert.equal(parseProperties('app_close', { error_code: 'unknown' }), undefined);
  assert.deepEqual(parseProperties('live_start', {}), {});
});
test('persisted events require UTC timestamp freshness, fixed envelope, UUID and safe versions', () => {
  const now = Date.now(), event = { event_id: randomUUID(), name: 'app_open', occurred_at: new Date(now).toISOString(),
    app_version: '0.9.10', channel: 'stable', platform: 'win32', properties: {} };
  assert.ok(parseEvent(event, now));
  for (const patch of [{ title: 'private' }, { event_id: 'hardware-id' }, { app_version: 'C:\\private' },
    { occurred_at: new Date(now - 31 * 86400000).toISOString() }, { occurred_at: new Date(now + 301000).toISOString() },
    { platform: 'device-serial-123' }, { properties: { application_list: [] } }]) assert.equal(parseEvent({ ...event, ...patch }, now), undefined);
  assert.equal(validVersion('1.2.3-beta..1'), false); assert.equal(validVersion('1.2.3'), true);
  assert.equal(validVersion('1.2.3-beta.01'), false);
  for (const url of ['http://example.com', 'https://user:password@example.com', 'https://example.com?key=secret']) assert.equal(validEndpoint(url), false);
  assert.equal(validEndpoint('https://example.com/smorec/api/events/batch'), true);
  assert.deepEqual([1, 2, 3, 10, 100].map(retryDelay), [1000, 2000, 4000, 300000, 300000]);
});
test('transport emits credential-free, nonredirecting batches and classifies retry versus permanent responses', async () => {
  const batch: TelemetryBatch = { schema_version: 1, installation_id: randomUUID(), events: [] };
  let captured: RequestInit | undefined;
  assert.equal(await sendBatch(async (_url, init) => { captured = init; return { status: 202 }; }, 'https://example.invalid', batch, new AbortController()), 'accepted');
  assert.equal(captured!.credentials, 'omit'); assert.equal(captured!.redirect, 'error'); assert.equal(captured!.referrerPolicy, 'no-referrer');
  for (const status of [408, 429, 500, 503]) assert.equal(await sendBatch(async () => ({ status }), 'https://example.invalid', batch, new AbortController()), 'retry');
  for (const status of [301, 400, 401, 403, 409, 413, 422]) assert.equal(await sendBatch(async () => ({ status }), 'https://example.invalid', batch, new AbortController()), 'rejected');
});
test('transport has a three-second deadline even if a fetch implementation ignores cancellation', async () => {
  const began = Date.now(), controller = new AbortController();
  const result = await sendBatch(async () => new Promise(() => {}), 'https://example.invalid',
    { schema_version: 1, installation_id: randomUUID(), events: [] }, controller);
  assert.equal(result, 'timeout'); assert.equal(controller.signal.aborted, true);
  assert.ok(Date.now() - began >= 2900 && Date.now() - began < 4500);
});
