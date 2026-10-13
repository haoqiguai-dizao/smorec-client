import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactFields, matchesArtifacts, releaseFiles } from '../scripts/distribution/release-artifacts';
import type { PlatformArtifact } from '../scripts/distribution/release-artifacts';

test('publishing supports paired Mac-only or combined artifacts without changing Windows flags', () => {
  const windows = { artifact: '小录-Setup-0.9.18.exe' }, mac = { 'mac-artifact': '小录-0.9.18-mac-arm64.dmg' };
  assert.deepEqual(releaseFiles(windows, '0.9.18').map(file => file.platform), ['win32', 'win32']);
  assert.deepEqual(releaseFiles(mac, '0.9.18').map(file => file.platform), ['darwin', 'darwin']);
  assert.equal(releaseFiles({ ...windows, ...mac }, '0.9.18').length, 4);
  assert.throws(() => releaseFiles(mac, '0.9.19'));
  assert.throws(() => releaseFiles({ 'mac-app-update': '小录-0.9.18-mac-arm64.zip' }, '0.9.18'));
});
test('Mac publishing never enters the legacy Windows installer/update fields', () => {
  const mac = ['.dmg', '.zip'].map(suffix => ({ platform: 'darwin', arch: 'arm64', name: `test${suffix}`,
    url: 'https://example.com/a', size: 123, sha256: 'a', sha512: 'b' }) as PlatformArtifact);
  const fields = artifactFields(mac);
  assert.deepEqual(fields.artifacts, []); assert.equal(fields.appUpdate, undefined);
  assert.equal(fields.macArtifacts?.length, 2);
  assert.equal(matchesArtifacts(mac, mac), true);
  assert.equal(matchesArtifacts(mac, [mac[0]]), false);
  assert.equal(matchesArtifacts(mac, [{ ...mac[0], sha512: 'changed' }, mac[1]]), false);
  assert.equal(matchesArtifacts(mac, [{ ...mac[0], url: 'https://example.com/b' }, mac[1]], true), false);
});
