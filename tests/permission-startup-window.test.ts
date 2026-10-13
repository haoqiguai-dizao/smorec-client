import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

async function fixture(platform = 'darwin') {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const instances: Window[] = [], commands: string[] = [];
  let granted = false, fails = false, quit = 0, loaded = 0;
  class Window extends EventEmitter {
    destroyed = false; shows = 0; url = '';
    webContents = Object.assign(new EventEmitter(), { mainFrame: { url: '' }, setWindowOpenHandler() {} });
    constructor(readonly options: unknown) { super(); instances.push(this); }
    loadURL = async (url: string) => { this.url = url; this.webContents.mainFrame.url = url; };
    show() { this.shows++; } focus() {} isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  }
  const injected = { app: Object.assign(new EventEmitter(), { getAppPath: () => '/fixture', isPackaged: false }),
    BrowserWindow: Window, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    ipcMain: { handle: (name: string, handler: (event: unknown) => Promise<unknown>) => handlers.set(name, handler) },
    systemPreferences: { getMediaAccessStatus: () => granted ? 'granted' : 'denied' } };
  const bundle = await build({ entryPoints: ['electron/services/platform/permission-startup-window.ts'], bundle: true,
    write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'startup-fixture', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'module.exports=injected;' }));
    } }] });
  const module = { exports: {} as { PermissionStartupWindow: new (native: unknown, quit: () => Promise<void>, loaded?: () => Promise<void>) => { ensure(): Promise<boolean>; isTrusted(event: unknown): boolean } } };
  new Function('require', 'module', 'exports', 'injected', 'process', bundle.outputFiles[0].text)(createRequire(import.meta.url), module,
    module.exports, injected, { platform, resourcesPath: '/fixture/resources' });
  const gate = new module.exports.PermissionStartupWindow({ request: async (command: string) => {
    commands.push(command); if (fails) throw new Error('unavailable');
    return { screenPermission: granted, microphonePermission: granted, inputPermission: granted, accessibilityPermission: granted };
  } }, async () => { quit++; }, async () => { loaded++; });
  return { gate, instances, commands, grant: () => { granted = true; }, fail: () => { fails = true; }, quits: () => quit, loaded: () => loaded,
    event: () => ({ sender: instances[0].webContents, senderFrame: instances[0].webContents.mainFrame }),
    invoke: (name: string, event?: unknown) => handlers.get('permission-startup:' + name)!(event ?? { sender: instances[0].webContents, senderFrame: instances[0].webContents.mainFrame }) };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('incomplete startup creates only the owned permission document; entry requires fresh actual grants', async () => {
  const f = await fixture(); const pending = f.gate.ensure(); await turn();
  assert.equal(f.instances.length, 1); assert.match(f.instances[0].url, /overlay=permission-startup$/);
  assert.deepEqual(f.commands, ['capabilities']);
  await assert.rejects(f.invoke('enter'), /还未全部生效/);
  assert.equal(f.instances[0].destroyed, false);
  await assert.rejects(f.invoke('enter', { sender: {} }), /来源/);
  f.grant(); await f.invoke('enter'); assert.equal(await pending, true);
  assert.equal(f.instances[0].destroyed, true); assert.ok(f.commands.every(value => value === 'capabilities'));
});
test('concurrent startup checks share one page, and ready or Windows startup has no page', async () => {
  const f = await fixture(); const first = f.gate.ensure(), second = f.gate.ensure(); await turn();
  assert.equal(f.instances.length, 1); f.grant(); await f.invoke('enter'); assert.equal(await first, true); assert.equal(await second, true);
  const ready = await fixture(); ready.grant(); assert.equal(await ready.gate.ensure(), true); assert.equal(ready.instances.length, 0);
  const windows = await fixture('win32'); assert.equal(await windows.gate.ensure(), true); assert.equal(windows.commands.length, 0);
});
test('failed permission read stays behind the startup gate and never opens the workspace', async () => {
  const f = await fixture(); f.fail(); void f.gate.ensure(); await turn();
  assert.equal(f.instances.length, 1); await assert.rejects(f.invoke('enter'), /unavailable/);
  assert.equal(f.loaded(), 0, 'A broken capture module must not confirm an update as healthy');
  await f.invoke('quit'); assert.equal(f.quits(), 1); assert.equal(f.instances[0].destroyed, false);
});
test('a loaded permission page confirms startup while access and workspace entry still wait for the human', async () => {
  const f = await fixture();
  let entered = false;
  const pending = f.gate.ensure().then(value => { entered = value; return value; });
  await turn();
  assert.equal(f.loaded(), 1);
  assert.equal(entered, false);
  assert.equal(f.instances[0].shows, 1);
  await assert.rejects(f.invoke('enter'), /还未全部生效/);
  assert.equal(entered, false);
  f.grant(); await f.invoke('enter'); assert.equal(await pending, true);
  assert.equal(f.loaded(), 1);
});
