import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertNoProjectLinks, managedProjectDirectory } from '../electron/services/project-paths';

const projectId = '6f99111a-c9d8-4d01-96c0-dba13af54b20';

interface Fixture {
  directory: string;
  root: string;
  outside: string;
  junction: (target: string, link: string) => Promise<void>;
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

async function fixture(run: (value: Fixture) => Promise<void>): Promise<void> {
  const output = path.resolve('output');
  await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'project-paths-'));
  const root = path.join(directory, 'projects'), outside = path.join(directory, 'outside');
  const junctions: string[] = [];
  try {
    await Promise.all([fs.mkdir(root), fs.mkdir(outside)]);
    await run({ directory, root, outside, junction: async (target, link) => {
      await fs.symlink(target, link, 'junction');
      junctions.push(link);
    } });
  } finally {
    // A junction is removed as a link only; never recurse into its target for cleanup.
    for (const link of junctions.reverse()) {
      const stats = await fs.lstat(link).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (!stats) continue;
      assert.ok(stats.isSymbolicLink(), 'Tracked junction must still be a link before unlinking');
      await fs.unlink(link);
    }
    const stats = await fs.lstat(directory);
    assert.ok(stats.isDirectory() && !stats.isSymbolicLink(), 'Cleanup target must be our real outer directory');
    const resolved = await fs.realpath(directory), outputReal = await fs.realpath(output);
    const relative = path.relative(outputReal, resolved);
    assert.ok(relative.startsWith('project-paths-') && !relative.includes(path.sep) && !path.isAbsolute(relative),
      'Cleanup must stay in one directly owned output/project-paths-* fixture');
    assert.ok(samePath(resolved, path.resolve(directory)), 'Cleanup must not follow a replaced outer directory');
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

test('a valid UUID resolves its lowercase direct child directory without requiring media files', async () => {
  await fixture(async ({ root }) => {
    const expected = path.join(root, projectId);
    await fs.mkdir(expected);
    const resolved = await managedProjectDirectory(root, projectId);
    assert.ok(samePath(resolved, await fs.realpath(expected)));
    assert.equal(await managedProjectDirectory(root, projectId.toUpperCase()), resolved,
      'Uppercase UUID aliases must normalize to the same lowercase project directory');
    assert.deepEqual(await fs.readdir(expected), [], 'Path validation must not require or create media');
  });
});

test('traversal, parent, nested, non-UUID and non-string IDs are rejected', async () => {
  await fixture(async ({ root }) => {
    await fs.mkdir(path.join(root, projectId));
    const invalid: unknown[] = ['', '.', '..', 'parent', 'not-a-uuid', '../' + projectId,
      projectId + '/nested', projectId + '\\nested', projectId + '/../' + projectId,
      null, undefined, 42, [projectId], { id: projectId },
      { toString: () => projectId }, ' ' + projectId, projectId + '\0'];
    for (const id of invalid) {
      await assert.rejects(managedProjectDirectory(root, id), `Reject ID ${String(id)}`);
    }
    assert.deepEqual(await fs.readdir(root), [projectId], 'Rejected IDs must not change the project root');
  });
});

test('a UUID regular file and a missing project directory are rejected', async () => {
  await fixture(async ({ root }) => {
    const file = path.join(root, projectId);
    await fs.writeFile(file, 'An ordinary file is not a managed project');
    await assert.rejects(managedProjectDirectory(root, projectId));
    assert.equal(await fs.readFile(file, 'utf8'), 'An ordinary file is not a managed project');
    await assert.rejects(managedProjectDirectory(root, '0c64a0bb-c503-4270-bc8d-596fc8fe7459'));
  });
});

test('a root which is a regular file or missing is rejected', async () => {
  await fixture(async ({ directory }) => {
    const file = path.join(directory, 'root-file');
    await fs.writeFile(file, 'Not a directory');
    await assert.rejects(managedProjectDirectory(file, projectId));
    await assert.rejects(managedProjectDirectory(path.join(directory, 'missing-root'), projectId));
    assert.equal(await fs.readFile(file, 'utf8'), 'Not a directory');
  });
});

test('a UUID junction escaping the project root is rejected without changing its target', async () => {
  await fixture(async ({ root, outside, junction }) => {
    const sentinel = path.join(outside, 'keep.txt');
    await fs.writeFile(sentinel, 'External fixture must remain unchanged');
    const link = path.join(root, projectId);
    await junction(outside, link);
    await assert.rejects(managedProjectDirectory(root, projectId));
    assert.ok((await fs.lstat(link)).isSymbolicLink());
    assert.equal(await fs.readFile(sentinel, 'utf8'), 'External fixture must remain unchanged');
    assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
  });
});

test('a UUID junction to another directory inside the root is also rejected', async () => {
  await fixture(async ({ root, junction }) => {
    const target = path.join(root, '0c64a0bb-c503-4270-bc8d-596fc8fe7459');
    await fs.mkdir(target);
    await junction(target, path.join(root, projectId));
    await assert.rejects(managedProjectDirectory(root, projectId));
    assert.deepEqual(await fs.readdir(target), []);
  });
});

test('a linked descendant is rejected before trash without traversing or changing its target', async () => {
  await fixture(async ({ root, outside, junction }) => {
    const directory = path.join(root, projectId); await fs.mkdir(directory);
    const nested = path.join(directory, 'ordinary-assets'); await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, 'metadata.txt'), 'Synthetic metadata');
    await assertNoProjectLinks(directory);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'Unchanged external fixture');
    await junction(outside, path.join(nested, 'linked-assets'));
    await assert.rejects(assertNoProjectLinks(directory), /链接/);
    assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
    assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'Unchanged external fixture');
  });
});

test('the managed root itself cannot be a junction even when its UUID child is real', async () => {
  await fixture(async ({ directory, outside, junction }) => {
    const targetProject = path.join(outside, projectId);
    await fs.mkdir(targetProject);
    const rootLink = path.join(directory, 'root-junction');
    await junction(outside, rootLink);
    await assert.rejects(managedProjectDirectory(rootLink, projectId));
    assert.ok((await fs.lstat(rootLink)).isSymbolicLink());
    assert.ok((await fs.lstat(targetProject)).isDirectory());
    assert.deepEqual(await fs.readdir(targetProject), []);
  });
});

test('a real-looking root reached through a junction ancestor cannot escape its lexical path', async () => {
  await fixture(async ({ directory, outside, junction }) => {
    const targetRoot = path.join(outside, 'projects');
    await fs.mkdir(path.join(targetRoot, projectId), { recursive: true });
    const alias = path.join(directory, 'ancestor-junction');
    await junction(outside, alias);
    const rootThroughAlias = path.join(alias, 'projects');
    assert.equal((await fs.lstat(rootThroughAlias)).isSymbolicLink(), false,
      'This case must exercise a linked ancestor, not just a directly linked root');
    await assert.rejects(managedProjectDirectory(rootThroughAlias, projectId));
    assert.deepEqual(await fs.readdir(targetRoot), [projectId]);
  });
});
