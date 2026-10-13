import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalJson, parseRelease } from '../electron/services/updates/manifest';
import { downloadPackage } from '../electron/services/updates/package-download';
import type { SignedRelease } from '../shared/update-types';

test('signed ZIP metadata preserves the installer contract for legacy clients', () => {
  const keys = generateKeyPairSync('ed25519');
  const artifact = { platform: 'win32' as const, arch: 'x64' as const, name: 'setup.exe', url: 'https://example.test/setup.exe', size: 10,
    sha256: 'a'.repeat(64), sha512: Buffer.alloc(64).toString('base64') };
  const payload: SignedRelease['payload'] = { product: 'smorec', version: '0.9.17', channel: 'stable', publishedAt: new Date().toISOString(),
    releaseNotes: '后台更新', artifacts: [artifact], appUpdate: { ...artifact, name: 'update.zip', url: 'https://example.test/update.zip' } };
  const release: SignedRelease = { schema: 1, keyId: 'test', payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64') };
  const config = { channel: 'stable' as const, serviceUrl: 'https://example.test', publicKeys: { test: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() } };
  assert.equal(parseRelease(release, config).payload.artifacts.length, 1);
  for (const mutation of [{ size: 11 }, { name: 'update.exe' }, { url: 'http://example.test/update.zip' }, { sha256: 'b'.repeat(64) }, { name: '../update.zip' }]) {
    assert.throws(() => parseRelease({ ...release, payload: { ...payload, appUpdate: { ...payload.appUpdate, ...mutation } } }, config));
  }
});

test('ZIP download validates both digests, length, cancellation and HTTPS redirects', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'smorec-zip-download-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bytes = Buffer.from('test signed app package');
  const artifact = { platform: 'win32' as const, arch: 'x64' as const, name: 'app.zip', url: 'https://example.test/download', size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), sha512: createHash('sha512').update(bytes).digest('base64') };
  let counter = 0;
  const run = (fetcher: typeof fetch, value = artifact, signal = new AbortController().signal) => downloadPackage(value, path.join(root, `${counter++}.zip`), fetcher, signal, () => {});
  await run(async (url, init) => {
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'manual');
    return String(url).endsWith('/download') ? new Response(null, { status: 302, headers: { location: 'https://cos.example.test/file' } }) : new Response(bytes);
  });
  await assert.rejects(run(async () => new Response(null, { status: 302, headers: { location: 'http://example.test/file' } })));
  await assert.rejects(run(async () => new Response(bytes.subarray(1))));
  await assert.rejects(run(async () => new Response(Buffer.concat([bytes, bytes]))));
  await assert.rejects(run(async () => new Response(bytes), { ...artifact, sha512: Buffer.alloc(64).toString('base64') }));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(run(async () => new Response(bytes), artifact, controller.signal));
});
