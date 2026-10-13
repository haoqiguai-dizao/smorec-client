import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import type { installCameraPermissions } from '../electron/services/media-permissions';
import type { BrowserWindow } from 'electron';
import type { CameraManager } from '../electron/services/camera';

test('failed capture retains discovery permission only in the authorized video main frame', async () => {
  const bundle = await build({ entryPoints: ['electron/services/media-permissions.ts'], bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'diagnostics', setup(builder) {
      builder.onResolve({ filter: /\/diagnostics$/ }, () => ({ path: 'diagnostics', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const diagnostic=()=>{};', loader: 'js' }));
    } }] });
  const module = { exports: {} as { installCameraPermissions: typeof installCameraPermissions } };
  new Function('module', 'exports', bundle.outputFiles[0].text)(module, module.exports);
  type Check = Parameters<Electron.Session['setPermissionCheckHandler']>[0];
  type Request = Parameters<Electron.Session['setPermissionRequestHandler']>[0];
  let check!: NonNullable<Check>, request!: NonNullable<Request>, prepared = false;
  const contents = { session: { setPermissionCheckHandler: (fn: NonNullable<Check>) => { check = fn; },
    setPermissionRequestHandler: (fn: NonNullable<Request>) => { request = fn; } } };
  const window = { webContents: contents } as unknown as BrowserWindow;
  const camera = { hasPermission: () => prepared } as CameraManager;
  const url = 'frameflow://app/index.html?overlay=launcher';
  const install = () => module.exports.installCameraPermissions(window, camera, value => value === url);
  install();
  const details = { isMainFrame: true, requestingUrl: url, mediaType: 'video' as const };
  const allowed = (overrides = {}) => check(window.webContents, 'media', 'frameflow://app', { ...details, ...overrides });
  assert.equal(allowed(), false);
  prepared = true; assert.equal(allowed(), true);
  prepared = false; assert.equal(allowed(), true, 'Retain names after cleanup and before another connection');
  for (const overrides of [{ isMainFrame: false }, { requestingUrl: 'https://untrusted.test' }, { mediaType: 'audio' }, { mediaType: 'unknown' }]) {
    assert.equal(allowed(overrides), false);
  }
  assert.equal(check(null, 'media', 'frameflow://app', details), false);
  let microphone: boolean | undefined;
  request(window.webContents, 'media', value => { microphone = value; }, { ...details, mediaTypes: ['audio'] });
  assert.equal(microphone, false);
  install(); assert.equal(allowed(), false, 'A new window needs its own explicit camera attempt');
});
