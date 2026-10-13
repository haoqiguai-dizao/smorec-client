import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const afterPack = require('../scripts/after-pack.cjs') as (event: {
  targetPresentableName: string; file: string; arch: number | null;
}) => Promise<void>;

for (const target of ['nsis', 'zip']) {
  test(`${target} creates the update manifest from the actual ArtifactBuildStarted event shape`, async () => {
    const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
    const directory = await fs.mkdtemp(path.join(output, 'update-build-'));
    try {
      const root = path.join(directory, 'win-unpacked'); await fs.mkdir(path.join(root, 'resources'), { recursive: true });
      const bytes = Buffer.from('packaged application');
      await fs.writeFile(path.join(root, 'resources', 'app.asar'), bytes);
      const event = { targetPresentableName: target, file: path.join(directory, `release.${target === 'nsis' ? 'exe' : 'zip'}`), arch: 1 };
      await afterPack(event); await afterPack(event);
      const result = JSON.parse(await fs.readFile(path.join(root, 'smorec-update-files.json'), 'utf8'));
      const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
      assert.equal(result.schema, 1); assert.equal(result.version, pkg.version);
      assert.deepEqual(result.files, [{ path: 'resources/app.asar', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]);
    } finally {
      assert.equal(path.dirname(path.resolve(directory)), output);
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
}

test('Mac archive events do not enter the Windows manifest hook', async () => {
  await afterPack({ targetPresentableName: 'macOS zip', file: 'nonexistent/mac.zip', arch: 3 });
  await afterPack({ targetPresentableName: 'dmg', file: 'nonexistent/mac.dmg', arch: 3 });
});
