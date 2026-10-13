import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { permissionGuideBounds } from '../electron/services/platform/permission-guide-geometry';

test('the entire guide stays below Settings or beside it across negative monitors and smaller displays', () => {
  const area = { x: -1920, y: -100, width: 1920, height: 1180 };
  assert.deepEqual(permissionGuideBounds(area, { x: -1400, y: 0, width: 600, height: 600 }),
    { x: -1202, y: 612, width: 390, height: 132 });
  const side = permissionGuideBounds(area, { x: -1400, y: 0, width: 600, height: 1000 });
  assert.equal(side.x, -788); assert.equal(side.y, 868);
  assert.deepEqual(permissionGuideBounds({ x: 0, y: 0, width: 300, height: 250 }),
    { x: 12, y: 94, width: 276, height: 132 });
  assert.equal(permissionGuideBounds(area, { x: -1400, y: 0, width: 600, height: 600 }).height, 132);
});
test('screen permission components fit outside Settings on the left or above when the bottom and right are occupied', () => {
  const area = { x: 0, y: 0, width: 1440, height: 1000 };
  const left = permissionGuideBounds(area, { x: 700, y: 200, width: 700, height: 750 });
  assert.ok(left.x + left.width <= 688);
  const above = permissionGuideBounds(area, { x: 100, y: 500, width: 1340, height: 500 });
  assert.ok(above.y + above.height <= 488);
});
async function fixture() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (_channel: string, action: string) => notifications.push(action) });
  const notifications: string[] = [];
  let busy = false;
  let settings: { bounds?: { x: number; y: number; width: number; height: number }; foreground?: boolean; failed?: boolean } = {
    bounds: { x: 100, y: 20, width: 700, height: 550 },
  };
  const commands: string[] = [];
  const instances: FakeWindow[] = [];
  class FakeWindow extends EventEmitter {
    destroyed = false; bounds: unknown = {}; load = ''; navigations: string[] = []; visible = false; moves = 0; focuses = 0;
    webContents = Object.assign(new EventEmitter(), { isDestroyed: () => this.destroyed, mainFrame: { url: '' },
      send: () => {}, setWindowOpenHandler: () => {} });
    constructor(public options: unknown) { super(); instances.push(this); }
    setAlwaysOnTop() {} show() { this.visible = true; } focus() { this.focuses++; } showInactive() { this.visible = true; } hide() { this.visible = false; }
    isVisible() { return this.visible; } getBounds() { return this.bounds; }
    async loadURL(url: string) { this.load = url; this.webContents.mainFrame.url = url; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    isDestroyed() { return this.destroyed; }
    setBounds(value: unknown) { this.moves++; this.bounds = value; }
  }
  const injected = { app: { on: () => {}, getAppPath: () => '/synthetic.app/Contents/Resources/app.asar' }, BrowserWindow: FakeWindow,
    ipcMain: { handle: (channel: string, callback: (event: unknown, ...args: unknown[]) => Promise<unknown>) => handlers.set(channel, callback) },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 1000 } }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 1000 } }) } };
  const bundled = await build({ entryPoints: ['electron/services/platform/permission-guide-window.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'fixture', setup(b) { b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'module.exports=injected' })); } }] });
  const module = { exports: {} as { PermissionGuideWindow: new (options: unknown) => { isTrusted(event: unknown): boolean; positionBySettings(): Promise<void> } } };
  new Function('require', 'module', 'exports', 'injected', 'process', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, injected, { platform: 'darwin' });
  const guide = new module.exports.PermissionGuideWindow({ trusted: (e: { sender: unknown }) => e.sender === owner, busy: () => busy,
    native: { request: async (command: string) => { commands.push(command); return settings; } } });
  return { guide, instances, notifications, owner, commands, settings: (value: typeof settings) => { settings = value; }, busy: () => { busy = true; },
    run: (channel: string, event: unknown, ...args: unknown[]) => handlers.get('permission-guide:' + channel)!(event, ...args),
    child: () => ({ sender: instances.at(-1)!.webContents, senderFrame: instances.at(-1)!.webContents.mainFrame }) };
}
const context = { kind: 'input', needs: ['screen', 'input', 'accessibility'], mode: 'record', inputDisabled: false };

test('native permission window grants IPC only to the exact owned document, uses sandbox and reports choices without starting capture', async () => {
  const f = await fixture();
  await assert.rejects(f.run('show', { sender: {} }, context), /来源/);
  await f.run('show', { sender: f.owner }, context);
  const window = f.instances[0];
  assert.equal(window.visible, true);
  assert.equal(window.focuses, 0, 'Settings guidance must not steal focus from native permission UI');
  assert.equal((window.options as { webPreferences: { sandbox: boolean } }).webPreferences.sandbox, true);
  assert.equal(f.guide.isTrusted(f.child()), true);
  assert.equal(f.guide.isTrusted({ ...f.child(), senderFrame: { url: window.load } }), false);
  window.webContents.mainFrame.url += '&foreign=1';
  assert.equal(f.guide.isTrusted(f.child()), false);
  window.webContents.mainFrame.url = window.load;
  await f.guide.positionBySettings();
  assert.deepEqual(window.bounds, { x: 329, y: 582, width: 459, height: 132 });
  await f.guide.positionBySettings(); assert.equal(window.moves, 1);
  assert.throws(() => f.run('step', f.child(), 'camera'), /步骤/);
  await f.run('step', f.child(), 'accessibility');
  await f.run('action', f.child(), 'skip-input');
  assert.deepEqual(f.notifications, ['skip-input']); assert.equal(window.destroyed, true);
});
test('the local automatic-camera choice still receives focus before system authorization starts', async () => {
  const f = await fixture();
  await f.run('show', { sender: f.owner }, { ...context, inputDisabled: true });
  assert.equal(f.instances[0].focuses, 1);
  await f.run('action', f.child(), 'skip-input');
});
test('invalid context and busy capture cannot launch or mutate permission choices; closed windows lose trust', async () => {
  const f = await fixture();
  for (const value of [{ ...context, needs: ['bogus'] }, { ...context, path: '/foreign.app' }, { ...context, inputDisabled: 1 }, { ...context, startup: 'yes' },
    { ...context, component: 'capture' }, { ...context, startup: true, component: 'application' },
    { ...context, kind: 'camera', startup: true, component: 'application' }]) {
    await assert.rejects(f.run('show', { sender: f.owner }, value), /参数/);
  }
  await f.run('show', { sender: f.owner }, context); const sender = f.child();
  f.busy(); await f.run('action', sender, 'enable-input');
  assert.deepEqual(f.notifications, []); assert.equal(f.guide.isTrusted(sender), false);
  await assert.rejects(f.run('show', { sender: f.owner }, context), /请先结束/);
});
test('startup keeps one component companion attached outside Settings without activation or permission requests', async () => {
  const f = await fixture(); f.settings({});
  const startup = { ...context, needs: ['input'], startup: true, component: 'capture' };
  await f.run('show', { sender: f.owner }, startup);
  const window = f.instances[0];
  assert.equal(window.visible, false); assert.equal(window.focuses, 0);
  f.settings({ bounds: { x: 100, y: 20, width: 700, height: 550 }, foreground: true });
  await f.guide.positionBySettings();
  assert.equal(window.visible, true);
  assert.deepEqual(window.bounds, { x: 329, y: 582, width: 459, height: 132 });
  await f.run('show', { sender: f.owner }, { ...startup, kind: 'accessibility', needs: ['accessibility'] });
  assert.equal(f.instances.length, 1); assert.equal(window.focuses, 0);
  f.settings({ bounds: { x: 100, y: 20, width: 700, height: 550 }, foreground: false });
  await f.guide.positionBySettings(); assert.equal(window.visible, false);
  f.settings({}); await f.guide.positionBySettings();
  assert.equal(window.destroyed, false, 'closing Settings hides the startup companion so reopening can restore it');
  assert.ok(f.commands.every(command => command === 'permission-settings-window'));
  assert.deepEqual(f.notifications, []);
  await f.run('action', f.child(), 'close'); assert.equal(window.destroyed, true);
});
