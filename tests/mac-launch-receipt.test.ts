import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseMacLaunchReceipt } from '../electron/services/platform/mac-launch-receipt';

test('launch receipt accepts the same filesystem application through a path alias', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-receipt-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, '小录.app'), alias = path.join(root, 'alias.app');
  await fs.mkdir(target); await fs.symlink(target, alias, 'dir');
  assert.deepEqual(parseMacLaunchReceipt(JSON.stringify({ pid: 123, target: alias }), target), { pid: 123, target });
  if (process.platform === 'darwin' && root.startsWith('/private/'))
    assert.deepEqual(parseMacLaunchReceipt(JSON.stringify({ pid: 123, target: target.slice('/private'.length) }), target), { pid: 123, target });
});
test('launch receipt refuses another application, missing paths, invalid pids and malformed data', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-receipt-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, '小录.app'), foreign = path.join(root, 'foreign.app');
  await fs.mkdir(target); await fs.mkdir(foreign);
  for (const receipt of [{ pid: 2, target: foreign }, { pid: 2, target: root + '/missing' },
    { pid: 1, target }, { pid: '123', target }, { pid: 2.5, target }, null, []])
    assert.throws(() => parseMacLaunchReceipt(JSON.stringify(receipt), target), /启动回执无效/);
  assert.throws(() => parseMacLaunchReceipt('not json', target), /启动回执无效/);
});
