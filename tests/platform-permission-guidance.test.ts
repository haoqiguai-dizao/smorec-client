import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { PermissionStatus } from '../shared/platform-permissions';

async function fixture() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const calls: string[] = [];
  let busy = false, trusted = true, granted = false;
  const injected = {
    app: { on: () => {} },
    ipcMain: {
      handle: (name: string, handler: typeof handlers extends Map<string, infer T> ? T : never) => handlers.set(name, handler),
      on: () => {},
    },
    shell: { openExternal: async (url: string) => { calls.push(url); } },
    systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: async () => { calls.push('parent-request'); } },
    desktopCapturer: { getSources: async () => [] },
  };
  const bundled = await build({ entryPoints: ['electron/services/platform/permissions.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'electron-fixture', setup(builder) {
      builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'module.exports = injected;' }));
    } }] });
  const module = { exports: {} as { installPlatformPermissions(options: unknown): void } };
  new Function('require', 'module', 'exports', 'injected', 'process', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, injected, { platform: 'darwin' });
  module.exports.installPlatformPermissions({ trusted: () => trusted, busy: () => busy,
    native: { request: async (command: string) => {
      calls.push(command);
      return command === 'capabilities' ? { screenPermission: true, microphonePermission: granted,
        microphoneAuthorization: granted ? 'granted' : 'not-determined', inputPermission: false, accessibilityPermission: false }
        : command === 'request-microphone' ? { granted: true } : {};
    } } });
  return { calls, run: (name: string, ...args: unknown[]) => handlers.get(name)!({}, ...args),
    busy: () => { busy = true; }, untrusted: () => { trusted = false; }, grant: () => { granted = true; } };
}

test('microphone readiness and first request come from the capture host, not parent permission', async () => {
  const f = await fixture();
  const status = await f.run('platform:permissions') as PermissionStatus[];
  assert.deepEqual(status.find(item => item.kind === 'microphone'), { kind: 'microphone', granted: false, access: 'not-determined' });
  await f.run('platform:permission-request', 'microphone');
  assert.deepEqual(f.calls, ['capabilities', 'request-microphone']);
  f.grant();
  assert.equal((await f.run('platform:permissions') as PermissionStatus[]).find(item => item.kind === 'microphone')?.granted, true);
});

test('settings route is exact and all changes reject active output, unknown kinds and foreign callers', async () => {
  const f = await fixture();
  await f.run('platform:permission-settings', 'screen');
  assert.deepEqual(f.calls, ['x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture']);
  await assert.rejects(f.run('platform:permission-settings', 'bogus'), /权限类型无效/);
  f.busy();
  await assert.rejects(f.run('platform:permission-settings', 'microphone'), /请先结束/);
  await assert.rejects(f.run('platform:permission-request', 'microphone'), /请先结束/);
  f.untrusted();
  await assert.rejects(f.run('platform:permissions'), /来源或参数无效/);
  await assert.rejects(f.run('platform:permission-settings', 'screen'), /来源或参数无效/);
  assert.equal(f.calls.length, 1);
});

test('opening and refreshing permissions never request access, and explicit input only triggers input without competing Settings', async () => {
  const f = await fixture();
  await f.run('platform:permissions'); await f.run('platform:permissions');
  assert.deepEqual(f.calls, ['capabilities', 'capabilities']);
  await f.run('platform:permission-request', 'input');
  assert.deepEqual(f.calls, ['capabilities', 'capabilities', 'request-input']);
  await f.run('platform:permission-request', 'accessibility');
  assert.equal(f.calls.at(-1), 'request-accessibility');
  assert.equal(f.calls.some(value => value.startsWith('x-apple.')), false);
});

test('screen requests select exactly one owner and reject forged component choices', async () => {
  const f = await fixture();
  await f.run('platform:permission-request', 'screen', 'capture');
  assert.deepEqual(f.calls, ['request-screen']);
  await assert.rejects(f.run('platform:permission-request', 'input', 'application'), /授权组件无效/);
  await assert.rejects(f.run('platform:permission-request', 'screen', 'arbitrary'), /授权组件无效/);
  assert.equal(f.calls.length, 1);
});


test('input and accessibility Settings buttons target their own privacy anchors without requesting another permission', async () => {
  const f = await fixture();
  await f.run('platform:permission-settings', 'input');
  await f.run('platform:permission-settings', 'accessibility');
  assert.deepEqual(f.calls, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  ]);
});
