import test from 'node:test';
import assert from 'node:assert/strict';
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import { ToolbarAutoCollapse } from '../src/services/toolbar-auto-collapse';
import { installToolbarPresentation, parseToolbarRegions } from '../electron/services/toolbar-presentation';

function collapseFixture() {
  const pending = new Set<() => void>(), changes: boolean[] = [];
  const controller = new ToolbarAutoCollapse(callback => {
    pending.add(callback); return () => { pending.delete(callback); };
  });
  controller.subscribe(() => changes.push(controller.snapshot()));
  const tick = () => { const callbacks = [...pending]; pending.clear(); callbacks.forEach(callback => callback()); };
  return { controller, changes, pending, tick };
}
test('compact controls remain clickable on hover and keyboard focus; expand is explicit', () => {
  const { controller, pending, changes, tick } = collapseFixture();
  controller.configure(false); tick(); assert.equal(controller.snapshot(), false);
  controller.pointer(true); controller.configure(true); tick(); assert.equal(controller.snapshot(), false);
  controller.pointer(false); assert.equal(pending.size, 1); assert.equal(controller.snapshot(), false);
  tick(); assert.equal(controller.snapshot(), true);
  controller.pointer(true); controller.focus(true); assert.equal(controller.snapshot(), true); assert.equal(pending.size, 0);
  controller.expand(); assert.equal(controller.snapshot(), false);
  assert.deepEqual(changes, [true, false]);
});
test('settings and keyboard focus cancel a pending collapse and retain all controls after mouse leave', () => {
  const { controller, pending, tick } = collapseFixture();
  controller.configure(true); controller.focus(true); tick(); assert.equal(controller.snapshot(), false);
  controller.pointer(false); tick(); assert.equal(controller.snapshot(), false);
  controller.focus(false); assert.equal(pending.size, 1);
  controller.configure(true, true); tick(); assert.equal(controller.snapshot(), false);
  controller.configure(true, false); tick(); assert.equal(controller.snapshot(), true);
  controller.configure(true, true); assert.equal(controller.snapshot(), false);
});
test('returning hover cancels the old timeout; stopping and disposal cannot leave a deferred collapse', () => {
  const { controller, pending, tick } = collapseFixture();
  controller.configure(true); controller.pointer(true); controller.pointer(false); controller.pointer(true);
  tick(); assert.equal(controller.snapshot(), false);
  controller.pointer(false); controller.configure(false); tick(); assert.equal(controller.snapshot(), false);
  controller.configure(true); controller.dispose(); assert.equal(pending.size, 0);
});
test('shape rectangles retain fractional-DPI edges and are clipped to the current native window', () => {
  const bounds = { width: 430, height: 78 };
  assert.deepEqual(parseToolbarRegions([{ x: 284.4, y: 36.7, width: 145.9, height: 43.5 }], bounds),
    [{ x: 284, y: 36, width: 146, height: 42 }]);
  assert.deepEqual(parseToolbarRegions([{ x: -5, y: -5, width: 440, height: 88 }], bounds),
    [{ x: 0, y: 0, width: 430, height: 78 }]);
  assert.deepEqual(parseToolbarRegions(null, bounds), []);
  for (const value of [[], false, undefined, Array(13).fill({ x: 0, y: 0, width: 20, height: 20 }),
    [{ x: 0, y: 0, width: Infinity, height: 20 }], [{ x: 500, y: 0, width: 30, height: 30 }],
    [{ x: 0, y: 0, width: '20', height: 20 }], [{ x: 0, y: 0, width: 1, height: 1 }]]) {
    assert.throws(() => parseToolbarRegions(value, bounds));
  }
});
test('shape IPC rejects unowned windows, subframes and camera/editor renderers before touching native shape', () => {
  let handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown = () => {};
  let removed = '', owned = true;
  const shapes: unknown[] = [], mainFrame = { url: 'frameflow://app/index.html?overlay=launcher' };
  const webContents = { mainFrame, isDestroyed: () => false };
  const window = { webContents, isDestroyed: () => false, getContentBounds: () => ({ width: 430, height: 78 }),
    setShape: (regions: unknown) => shapes.push(regions) } as unknown as BrowserWindow;
  const ipcMain = { handle: (_channel: string, callback: typeof handler) => { handler = callback; },
    removeHandler: (channel: string) => { removed = channel; } } as unknown as IpcMain;
  const cleanup = installToolbarPresentation({ ipcMain, resolveWindow: () => owned ? window : undefined,
    setRegions: (window, regions, options) => {
      assert.deepEqual(options, { inputOnly: true }); window!.setShape(regions);
    } });
  const event = { sender: webContents, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  handler(event, [{ x: 260, y: 38, width: 160, height: 35 }]); assert.equal(shapes.length, 1);
  assert.throws(() => handler({ ...event, senderFrame: { ...mainFrame } } as IpcMainInvokeEvent, null));
  assert.throws(() => handler({ ...event, sender: {} } as IpcMainInvokeEvent, null));
  for (const url of ['frameflow://app/index.html?overlay=camera', 'frameflow://app/index.html', 'https://app/index.html?overlay=toolbar']) {
    mainFrame.url = url; assert.throws(() => handler(event, null));
  }
  mainFrame.url = 'frameflow://app/index.html?overlay=toolbar'; handler(event, null); assert.equal(shapes.length, 2);
  assert.throws(() => handler(event, null, null));
  owned = false; assert.throws(() => handler(event, null)); assert.equal(shapes.length, 2);
  cleanup(); assert.equal(removed, 'toolbar-presentation:regions');
});
