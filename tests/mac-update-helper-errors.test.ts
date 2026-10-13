import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMacHelper } from '../electron/services/updates/mac/package';
import { updateFailureMessage } from '../electron/services/updates/outcome';

test('Mac helper failures retain their cause and show only safe user messages', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-helper-error-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const helper = path.join(root, 'helper.cjs');
  for (const message of ['Mac 更新 ZIP 必须只包含当前应用', 'command failed: /private/user/file']) {
    await fs.writeFile(helper, `console.error(new Error(${JSON.stringify(message)})); process.exitCode = 1;`);
    await assert.rejects(runMacHelper(process.execPath, helper, 'stage', path.join(root, 'plan.json')), error => {
      assert.ok(error instanceof Error && error.cause instanceof Error);
      assert.match(error.cause.message, /helper\.cjs/);
      assert.equal(updateFailureMessage(error), message.startsWith('Mac ')
        ? `${message}，点击重试` : '更新包下载或准备失败，请点击重试');
      assert.ok(!updateFailureMessage(error).includes(root));
      return true;
    });
  }
});
