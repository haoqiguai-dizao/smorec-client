import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

async function fixture(t: test.TestContext, name = '小录.app') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-permission-components-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const main = path.join(root, name), capture = path.join(main, 'Contents/Resources/native/XiaoLu.Capture.app');
  for (const folder of [main, capture]) { await fs.mkdir(path.join(folder, 'Contents/MacOS'), { recursive: true }); await fs.writeFile(path.join(folder, 'Contents/Info.plist'), 'fixture'); }
  const appPath = path.join(main, 'Contents/Resources/app.asar');
  let executable = path.join(capture, 'Contents/MacOS/XiaoLu.Capture'), busy = false, trusted = true;
  let applicationGranted = false, captureGranted = false;
  const handlers = new Map<string, (...args: unknown[]) => unknown>(), events = new Map<string, (...args: unknown[]) => unknown>();
  const drags: {file:string}[] = [], reveals: string[] = [], errors: string[] = [];
  const icon = { isEmpty: () => false, resize: () => icon };
  const injected = { app: { getAppPath: () => appPath, isPackaged: true }, nativeImage: { createFromPath: () => icon },
    ipcMain: { handle: (n: string, h: (...args: unknown[]) => unknown) => handlers.set(n, h), on: (n: string, h: (...args: unknown[]) => unknown) => events.set(n, h) },
    shell: { showItemInFolder: (file: string) => reveals.push(file) },
    systemPreferences: { getMediaAccessStatus: () => applicationGranted ? 'granted' : 'denied' } };
  const bundled = await build({ entryPoints: ['electron/services/platform/permission-components.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'electron-fixture', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'module.exports = injected;' }));
  } }] });
  const module = { exports: {} as { installPermissionComponents(options: unknown): void } };
  new Function('require', 'module', 'exports', 'injected', 'process', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, injected, { platform: 'darwin', resourcesPath: path.join(main, 'Contents/Resources') });
  module.exports.installPermissionComponents({ trusted: () => trusted, busy: () => busy, executable: () => executable,
    native: { request: async () => ({ screenPermission: captureGranted }) } });
  const event = { sender: { startDrag: (item: {file:string}) => drags.push(item), send: (_channel: string, message: string) => errors.push(message) } };
  return { main, capture, drags, reveals, errors,
    run: (n: string, ...args: unknown[]) => handlers.get('platform:permission-' + n)!(event, ...args),
    drag: (...args: unknown[]) => events.get('platform:permission-drag')!(event, ...args),
    grantApplication: () => { applicationGranted = true; }, grantCapture: () => { captureGranted = true; },
    busy: () => { busy = true; }, untrusted: () => { trusted = false; }, foreign: () => { executable = path.join(root, 'foreign.app/Contents/MacOS/helper'); } };
}
test('component cards and native drags use the actual installed capture host and expose no filesystem path', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.run('components', 'screen'), [{ id: 'application', name: '小录', role: '主应用', granted: false }, { id: 'capture', name: '小录采集', role: '录制组件', granted: false }]);
  assert.deepEqual(await f.run('components', 'input'), [{ id: 'capture', name: '小录采集', role: '录制组件' }]);
  f.drag('input', 'capture'); assert.equal(f.drags[0].file, f.capture);
  f.run('reveal', 'camera', 'application'); assert.deepEqual(f.reveals, [f.main]);
  assert.throws(() => f.run('reveal', 'input', 'application'), /对应授权组件/);
});
test('arbitrary paths, unknown permissions, foreign senders and active captures cannot drag an application', async t => {
  const f = await fixture(t);
  f.drag('screen', '/Applications/Other.app'); assert.equal(f.drags.length, 0); assert.equal(f.errors.length, 1);
  await assert.rejects(f.run('components', 'arbitrary') as Promise<unknown>, /权限类型/);
  f.busy(); f.drag('screen', 'capture'); assert.match(f.errors[1], /请先结束/);
  f.untrusted(); f.drag('screen', 'application'); assert.equal(f.errors.length, 2); assert.equal(f.drags.length, 0);
  await assert.rejects(f.run('components', 'screen') as Promise<unknown>, /来源/);
});
test('a capture executable outside the application cannot be offered as an authorization component', async t => {
  const f = await fixture(t); f.foreign(); assert.deepEqual(await f.run('components', 'input'), []);
  assert.throws(() => f.run('reveal', 'input', 'capture'), /对应授权组件/);
});
test('screen components distinguish the parent grant from the capture grant without treating a drag as authorization', async t => {
  const f = await fixture(t);
  f.grantApplication();
  const before = await f.run('components', 'screen') as { id: string; granted: boolean }[];
  assert.deepEqual(before.map(item => [item.id, item.granted]), [['application', true], ['capture', false]]);
  f.drag('screen', 'capture');
  assert.equal((await f.run('components', 'screen') as { granted: boolean }[])[1].granted, false);
  f.grantCapture();
  assert.ok((await f.run('components', 'screen') as { granted: boolean }[]).every(item => item.granted));
});
test('renamed failed or previous updater applications are never offered or dragged for privacy authorization', async t => {
  for (const name of ['.xiaolu-failed-test.app', '.xiaolu-previous-test.app']) {
    const f = await fixture(t, name);
    assert.deepEqual(await f.run('components', 'screen'), []);
    f.drag('screen', 'application');
    assert.equal(f.drags.length, 0);
    assert.match(f.errors[0], /对应授权组件/);
  }
});
