import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalJson, compareVersions, parseRelease, secureUrl } from '../electron/services/updates/manifest';
import type { ReleasePayload, SignedRelease, UpdateConfiguration } from '../shared/update-types';
const keys = generateKeyPairSync('ed25519');
const config: UpdateConfiguration = { channel: 'stable', serviceUrl: 'https://updates.example.test',
  publicKeys: { test: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() } };
function release(): SignedRelease {
  const payload: ReleasePayload = { product: 'smorec', version: '0.9.11', channel: 'stable', publishedAt: '2026-09-08T12:00:00Z',
    releaseNotes: '新增自动更新与直播统计', artifacts: [{ platform: 'win32', arch: 'x64', name: '小录-Setup-0.9.11.exe',
      url: 'https://updates.example.test/0.9.11.exe', size: 1024, sha256: 'a'.repeat(64), sha512: Buffer.alloc(64).toString('base64') }] };
  return { schema: 1, keyId: 'test', payload, signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64') };
}
test('release signature matches canonical Chinese UTF-8 metadata independent of key order', () => {
  const signed = release(); assert.equal(parseRelease(signed, config).payload.version, '0.9.11');
  const reordered = { ...signed, payload: Object.fromEntries(Object.entries(signed.payload).reverse()) };
  assert.equal(parseRelease(reordered, config).signature, signed.signature);
  assert.equal(canonicalJson({ 中: '小录', z: 2, a: [true, null] }), '{"a":[true,null],"z":2,"中":"小录"}');
});
test('metadata, digest, and artifact address tampering are rejected', () => {
  for (const mutate of [(r: SignedRelease) => { r.payload.version = '0.9.12'; },
    (r: SignedRelease) => { r.payload.artifacts[0].sha256 = 'b'.repeat(64); },
    (r: SignedRelease) => { r.payload.artifacts[0].url = 'https://evil.example.test/setup.exe'; },
    (r: SignedRelease) => { r.payload.releaseNotes = '伪造更新'; }]) {
    const value = release(); mutate(value); assert.throws(() => parseRelease(value, config));
  }
});
test('untrusted keys, product/channel crossover, non-HTTPS addresses and path names are rejected', () => {
  for (const mutate of [(r: SignedRelease) => { r.keyId = '__proto__'; },
    (r: SignedRelease) => { r.payload.channel = 'beta'; },
    (r: SignedRelease) => { r.payload.artifacts[0].url = 'http://updates.example.test/setup.exe'; },
    (r: SignedRelease) => { r.payload.artifacts[0].name = '../setup.exe'; }]) {
    const value = release(); mutate(value); assert.throws(() => parseRelease(value, config));
  }
  assert.throws(() => secureUrl('https://token@updates.example.test/setup.exe'));
  assert.throws(() => secureUrl('file:///C:/setup.exe'));
});
test('version ordering never treats 0.9.9 as newer than 0.9.11 and stable wins prerelease', () => {
  assert.ok(compareVersions('0.9.11', '0.9.9') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.0-beta.99') > 0);
  assert.ok(compareVersions('1.0.0-beta.10', '1.0.0-beta.9') > 0);
  assert.equal(compareVersions('0.9.11', '0.9.11'), 0);
  assert.equal(compareVersions('1.0.0+build.2', '1.0.0+build.1'), 0);
  for (const value of ['0.09.11', 'latest', '../1.0.0', '1.0.0\n', '1.0.0-alpha.01', 'v1.0.0']) assert.throws(() => compareVersions(value, '0.9.11'));
});
test('canonical signatures reject floats, undefined values, and unsupported payload shapes', () => {
  for (const value of [NaN, Infinity, 1.5, { a: undefined }]) assert.throws(() => canonicalJson(value));
  assert.throws(() => parseRelease(null, config));
  const value = release(); value.payload.artifacts[0].size = Number.MAX_SAFE_INTEGER;
  assert.throws(() => parseRelease(value, config));
});
