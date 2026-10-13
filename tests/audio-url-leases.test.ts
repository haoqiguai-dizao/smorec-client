import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioUrlLeases } from '../src/services/audio-url-leases';

test('discarded jobs do not revoke a URL still used by its owner or player', () => {
  const released: string[] = [], leases = new AudioUrlLeases(url => released.push(url));
  const url = 'frameflow://audio/asset', owner = leases.retain(url), player = leases.retain(url);
  leases.discard(url); owner(); owner();
  assert.deepEqual(released, []);
  player(); player(); assert.deepEqual(released, [url]);
  leases.discard('frameflow://audio/unused');
  assert.deepEqual(released, [url, 'frameflow://audio/unused']);
});

test('raw project and browser fixture URLs are not sent to the temporary-audio API', () => {
  const released: string[] = [], leases = new AudioUrlLeases(url => released.push(url));
  for (const url of [undefined, 'frameflow://media/project/system', 'http://127.0.0.1/system.wav', 'blob:sample']) {
    leases.retain(url)(); leases.discard(url);
  }
  assert.deepEqual(released, []);
});
