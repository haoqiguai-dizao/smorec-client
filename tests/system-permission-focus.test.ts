import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import type * as Focus from '../electron/services/platform/system-permission-focus';

async function fixture(platform = 'darwin') {
  const app = new EventEmitter();
  const windows: FakeWindow[] = [];
  let focused: FakeWindow | null = null;
  class FakeWindow extends EventEmitter {
    top = false; level = 0; destroyed = false;
    constructor() { super(); windows.push(this); }
    setAlwaysOnTop(top: boolean, _level?: string, relativeLevel = 0) { this.top = top; this.level = relativeLevel; }
    isAlwaysOnTop() { return this.top; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; this.emit('closed'); }
    static getAllWindows() { return windows; }
    static getFocusedWindow() { return focused; }
  }
  const bundled = await build({ entryPoints: ['electron/services/platform/system-permission-focus.ts'],
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'fixture', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'module.exports=injected;' }));
    } }] });
  const module = { exports: {} as typeof Focus };
  new Function('require', 'module', 'exports', 'injected', 'process', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, { app, BrowserWindow: FakeWindow }, { platform });
  const register = (window: FakeWindow, level: number) => module.exports.setFloatingWindow(window as never, level);
  return { ...module.exports, window: () => new FakeWindow(), register,
    focus(window: FakeWindow | null) { focused = window; app.emit('browser-window-focus'); } };
}

test('system dialogs retain foreground after IPC resolves and returning restores each overlay level', async () => {
  const f = await fixture();
  const toolbar = f.window(), guide = f.window(), editor = f.window();
  f.register(toolbar, 2); f.register(guide, 3);
  await f.withSystemPermissionFocus(async () => {
    assert.equal(toolbar.top, false); assert.equal(guide.top, false);
    f.focus(null);
  });
  assert.equal(toolbar.top, false); assert.equal(guide.top, false);
  f.focus(toolbar);
  assert.equal(toolbar.top, true); assert.equal(toolbar.level, 2);
  assert.equal(guide.top, true); assert.equal(guide.level, 3);
  assert.equal(editor.top, false);
});

test('concurrent requests and overlays created during handoff cannot restore topmost prematurely', async () => {
  const f = await fixture(), toolbar = f.window();
  f.register(toolbar, 2);
  let finish!: () => void;
  const first = f.withSystemPermissionFocus(() => new Promise<void>(resolve => { finish = resolve; }));
  const camera = f.window(); f.register(camera, 1);
  await f.withSystemPermissionFocus(async () => { f.focus(toolbar); });
  assert.equal(toolbar.top, false); assert.equal(camera.top, false);
  camera.close(); finish(); await first;
  assert.equal(toolbar.top, true); assert.equal(toolbar.level, 2);
  assert.equal(camera.top, false);
});

test('opening Settings cannot restore topmost while macOS is still launching the external window', async () => {
  const f = await fixture(), toolbar = f.window(); f.register(toolbar, 2); f.focus(toolbar);
  await f.withSystemPermissionFocus(async () => {});
  assert.equal(toolbar.top, false, 'An existing focus is not a return from system authorization');
  f.focus(toolbar); assert.equal(toolbar.top, true);
});

test('failed requests recover when the user returns; Windows keeps its existing window behavior', async () => {
  const f = await fixture(), toolbar = f.window(); f.register(toolbar, 2);
  await assert.rejects(f.withSystemPermissionFocus(async () => { throw new Error('denied'); }), /denied/);
  assert.equal(toolbar.top, false); f.focus(toolbar); assert.equal(toolbar.top, true);
  const windows = await fixture('win32'), control = windows.window(); control.setAlwaysOnTop(true);
  await windows.withSystemPermissionFocus(async () => { assert.equal(control.top, true); });
});
