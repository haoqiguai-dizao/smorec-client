import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import type { virtualCameraStatus } from '../electron/services/live/virtual-camera';

const bundle = build({ entryPoints: ['electron/services/live/virtual-camera.ts'], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });

async function status(platform: string, response: object, exists = true) {
  const calls: string[][] = [], module = { exports: {} as { virtualCameraStatus: typeof virtualCameraStatus } };
  const require = createRequire(import.meta.url);
  const testRequire = (name: string) => name === 'electron' ? { app: { getAppPath: () => path.resolve('synthetic-app') } }
    : name === 'node:fs' ? { existsSync: () => exists }
      : name === 'node:child_process' ? { execFile: (_file: string, args: string[], _options: unknown,
        callback: (error: null, stdout: string, stderr: string) => void) => {
        calls.push(args); callback(null, JSON.stringify(response), '');
      } } : require(name);
  new Function('require', 'module', 'exports', 'process', (await bundle).outputFiles[0].text)(testRequire, module, module.exports,
    { ...process, platform, resourcesPath: path.resolve('synthetic-resources') });
  return { value: await module.exports.virtualCameraStatus(), calls };
}

test('a publisher signing blocker remains actionable status without attempting installation', async () => {
  const error = '此版本缺少 Apple 开发者签名，暂不能启用 Mac 虚拟摄像头';
  const result = await status('darwin', { installed: false, compatible: false, installable: false, error });
  assert.deepEqual(result.value, { available: true, installed: false, installable: false, name: '小录 Virtual Camera', error });
  assert.deepEqual(result.calls, [['status']]);
});

test('an existing compatible Mac camera remains available without requesting another installation', async () => {
  const result = await status('darwin', { installed: true, compatible: true, installable: true });
  assert.equal(result.value.installed, true); assert.equal(result.value.error, undefined);
  assert.deepEqual(result.calls, [['status']]);
});

test('Windows bridge status without the new optional installability field remains compatible', async () => {
  const result = await status('win32', { installed: true, compatible: true });
  assert.equal(result.value.installed, true); assert.equal(result.value.installable, undefined);
  assert.deepEqual(result.calls, [['status']]);
  assert.equal((await status('win32', { installed: true, compatible: false })).value.installed, false);
});

test('a missing packaged bridge is reported as unavailable without invoking a native command', async () => {
  const result = await status('darwin', {}, false);
  assert.equal(result.value.available, false); assert.equal(result.value.installed, false);
  assert.deepEqual(result.calls, []);
});
