import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalJson, macReleaseArtifact, parseRelease, releaseArtifact } from '../electron/services/updates/manifest';
import type { SignedRelease } from '../shared/update-types';

const keys = generateKeyPairSync('ed25519');
const config = { channel: 'stable' as const, serviceUrl: 'https://updates.example.test',
  publicKeys: { test: keys.publicKey.export({ format: 'pem', type: 'spki' }).toString() } };
function signed(macOnly = false): SignedRelease {
  const fields = { size: 500, sha256: 'a'.repeat(64), sha512: Buffer.alloc(64).toString('base64') };
  const payload: SignedRelease['payload'] = { product: 'smorec', version: '0.9.18', channel: 'stable',
    publishedAt: '2026-09-10T00:00:00Z', releaseNotes: '双端更新',
    artifacts: macOnly ? [] : [{ ...fields, platform: 'win32', arch: 'x64', name: 'setup.exe', url: 'https://updates.example.test/setup.exe' }],
    macArtifacts: ['dmg', 'zip'].map(ext => ({ ...fields, platform: 'darwin', arch: 'arm64',
      name: 'xiaolu-arm64.' + ext, url: 'https://updates.example.test/xiaolu-arm64.' + ext })) };
  return { schema: 1, keyId: 'test', payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), keys.privateKey).toString('base64') };
}
test('Mac manifests preserve the Windows installer and select only the Mac ZIP for updates', () => {
  const both = signed();
  assert.equal(releaseArtifact(parseRelease(both, config)).name, 'setup.exe');
  assert.equal(macReleaseArtifact(parseRelease(both, config, 'darwin')).name, 'xiaolu-arm64.zip');
  assert.throws(() => parseRelease(signed(true), config, 'win32'));
  assert.equal(parseRelease(signed(true), config, 'darwin').payload.artifacts.length, 0);
});
test('Mac file identity, platform, missing pairs and signed URL changes are rejected', () => {
  for (const change of [
    (r: SignedRelease) => { r.payload.macArtifacts!.pop(); },
    (r: SignedRelease) => { r.payload.macArtifacts![1].name = '../wrong.zip'; },
    (r: SignedRelease) => { r.payload.macArtifacts![1].url = 'https://other.example.test/changed.zip'; },
    (r: SignedRelease) => { r.payload.macArtifacts![1].sha256 = 'b'.repeat(64); },
  ]) { const value = signed(); change(value); assert.throws(() => parseRelease(value, config, 'darwin')); }
});
