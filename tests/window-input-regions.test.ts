import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import type { BrowserWindow, Rectangle } from 'electron';

async function fixture(platform: string) {
  const pending = new Set<() => void>();
  let cursor = { x: 0, y: 0 };
  const electron = { screen: { getCursorScreenPoint: () => cursor } };
  const source = await build({ entryPoints: ['electron/services/platform/window-regions.ts'], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const module = { exports: {} as { setWindowInputRegions(window: BrowserWindow, regions: Rectangle[], options?: { inputOnly: boolean }): void } };
  const require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', 'process', 'setInterval', 'clearInterval', source.outputFiles[0].text)(
    (id: string) => id === 'electron' ? electron : require(id), module, module.exports, { platform },
    (callback: () => void) => { pending.add(callback); return { unref() {}, callback }; },
    (timer: { callback: () => void }) => pending.delete(timer.callback));
  class Window extends EventEmitter {
    visible = true; destroyed = false; bounds = { x: 100, y: 200, width: 1120, height: 704 };
    shapes: Rectangle[][] = []; ignored: boolean[] = [];
    webContents = new EventEmitter();
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    getContentBounds() { return this.bounds; }
    setShape(regions: Rectangle[]) { this.shapes.push(regions); }
    setIgnoreMouseEvents(ignored: boolean, options: { forward: boolean }) {
      assert.equal(options.forward, true); this.ignored.push(ignored);
    }
  }
  const window = new Window();
  return { window, pending, set: (regions: Rectangle[]) => module.exports.setWindowInputRegions(window as unknown as BrowserWindow, regions, { inputOnly: true }),
    move: (x: number, y: number) => { cursor = { x, y }; pending.forEach(callback => callback()); } };
}

for (const platform of ['win32', 'darwin']) {
  test(`${platform}: settings collapse cannot clip the toolbar while input regions are being remeasured`, async () => {
    const { window, set, move, pending } = await fixture(platform);
    set([{ x: 8, y: 628, width: 1104, height: 68 }]);
    move(200, 850); assert.equal(window.ignored.at(-1), false);
    // The main process resizes first; the renderer can still have regions from the 704px layout.
    window.bounds.height = 96;
    move(900, 250);
    assert.deepEqual(window.shapes, [], 'Input regions must never restrict Windows/macOS drawing');
    set([{ x: 590, y: 35, width: 522, height: 58 }]);
    move(1100, 260); assert.equal(window.ignored.at(-1), false, 'Compact stop stays clickable');
    move(120, 210); assert.equal(window.ignored.at(-1), true, 'Transparent reserves pass through');
    window.webContents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    assert.equal(window.ignored.at(-1), false, 'A drag retains mouse input outside the surface');
    window.webContents.emit('before-mouse-event', {}, { type: 'mouseUp' });
    assert.equal(window.ignored.at(-1), true);
    set([]); assert.equal(window.ignored.at(-1), false, 'Stopping restores input immediately');
    window.destroyed = true; window.emit('closed'); assert.equal(pending.size, 0);
  });
}

test('Linux retains its supported shape path without installing a pointer poll', async () => {
  const { window, set, pending } = await fixture('linux');
  const regions = [{ x: 5, y: 5, width: 40, height: 20 }];
  set(regions); assert.deepEqual(window.shapes, [regions]); assert.equal(pending.size, 0);
});
