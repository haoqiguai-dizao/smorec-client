import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { initializeProjectDirectory } from '../electron/services/project-directory';

async function fixture(run: (parent: string, old: string, current: string) => Promise<void>) {
  const output = path.resolve('output');
  await fs.mkdir(output, { recursive: true });
  const parent = await fs.mkdtemp(path.join(output, 'project-directory-'));
  try { await run(parent, path.join(parent, 'FrameFlow'), path.join(parent, '小录')); }
  finally {
    assert.equal(path.dirname(path.resolve(parent)), output);
    await fs.rm(parent, { recursive: true, force: true });
  }
}

test('new installations use 小录, including a missing system media directory', () => fixture(async parent => {
  const videos = path.join(parent, 'Videos');
  const result = await initializeProjectDirectory(videos);
  assert.deepEqual(result, { directory: path.join(videos, '小录'), status: 'current' });
  assert.deepEqual(await fs.readdir(videos), []);
}));

test('whole-library migration preserves media, relative project paths and incomplete recordings across restart', () => fixture(async (parent, old, current) => {
  const id = '3cdac8eb-eaa4-499f-9e1f-e7a98e4d9939';
  await fs.mkdir(path.join(old, id), { recursive: true });
  await fs.mkdir(path.join(old, 'unfinished'));
  const project = JSON.stringify({ project: { id, media: { screen: 'screen.mp4' } } });
  const video = Buffer.from([0, 3, 7, 255]);
  await fs.writeFile(path.join(old, id, 'project.json'), project);
  await fs.writeFile(path.join(old, id, 'screen.mp4'), video);
  await fs.writeFile(path.join(old, 'unfinished', 'microphone.wav'), video);
  assert.deepEqual(await initializeProjectDirectory(parent), { directory: current, status: 'migrated' });
  assert.equal(await fs.readFile(path.join(current, id, 'project.json'), 'utf8'), project);
  assert.deepEqual(await fs.readFile(path.join(current, id, 'screen.mp4')), video);
  assert.deepEqual(await fs.readFile(path.join(current, 'unfinished', 'microphone.wav')), video);
  await assert.rejects(fs.stat(old), { code: 'ENOENT' });
  assert.deepEqual(await initializeProjectDirectory(parent), { directory: current, status: 'current' });
}));

for (const kind of ['empty-directory', 'populated-directory', 'file'] as const) {
  test(`existing destination (${kind}) is not overwritten; legacy library remains active`, () => fixture(async (parent, old, current) => {
    await fs.mkdir(old); await fs.writeFile(path.join(old, 'sentinel'), 'old');
    if (kind === 'file') await fs.writeFile(current, 'destination');
    else {
      await fs.mkdir(current);
      if (kind === 'populated-directory') await fs.writeFile(path.join(current, 'sentinel'), 'destination');
    }
    const before = await fs.lstat(current);
    assert.deepEqual(await initializeProjectDirectory(parent), { directory: old, status: 'legacy', reason: 'destination-exists' });
    assert.equal(await fs.readFile(path.join(old, 'sentinel'), 'utf8'), 'old');
    assert.equal((await fs.lstat(current)).ino, before.ino);
    if (kind !== 'empty-directory') assert.equal(await fs.readFile(kind === 'file' ? current : path.join(current, 'sentinel'), 'utf8'), 'destination');
  }));
}

test('locked library falls back without copying/deleting and migration can retry on next startup', () => fixture(async (parent, old, current) => {
  await fs.mkdir(old); await fs.writeFile(path.join(old, 'sentinel'), 'unchanged');
  const failure = Object.assign(new Error('locked'), { code: 'EPERM' });
  const result = await initializeProjectDirectory(parent, async () => { throw failure; });
  assert.deepEqual(result, { directory: old, status: 'legacy', reason: 'rename-failed' });
  assert.equal(await fs.readFile(path.join(old, 'sentinel'), 'utf8'), 'unchanged');
  await assert.rejects(fs.stat(current), { code: 'ENOENT' });
  assert.equal((await initializeProjectDirectory(parent)).status, 'migrated');
}));

for (const name of ['FrameFlow', '小录']) {
  test(`rejects a linked ${name} root without moving the linked data`, () => fixture(async parent => {
    const outside = path.join(parent, 'outside');
    await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'sentinel'), 'safe');
    await fs.symlink(outside, path.join(parent, name), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(initializeProjectDirectory(parent), /链接/);
    assert.equal(await fs.readFile(path.join(outside, 'sentinel'), 'utf8'), 'safe');
  }));
}

test('existing legacy file is not silently abandoned', () => fixture(async (parent, old) => {
  await fs.writeFile(old, 'unexpected');
  await assert.rejects(initializeProjectDirectory(parent), /文件/);
  assert.equal(await fs.readFile(old, 'utf8'), 'unexpected');
}));
