import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { LivePreview } from '../src/services/live/preview';
import { watchPreviewVisibility } from '../electron/services/live/preview-visibility';

function fixture(t: test.TestContext, width = 1920, height = 1080) {
  let draws = 0, removed = false;
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => { draws++; } }), remove: () => { removed = true; } };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = { hidden: false, createElement: () => canvas };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else Reflect.deleteProperty(globalThis, 'document'); });
  return { preview: new LivePreview(width, height), source: {} as HTMLCanvasElement, canvas, document,
    draws: () => draws, removed: () => removed };
}

test('display preview bounds landscape and portrait pixels without upscaling', t => {
  const f = fixture(t);
  for (const [width, height, expected] of [[1920, 1080, [640, 360]], [1080, 1920, [360, 640]], [320, 180, [320, 180]]] as const) {
    const preview = new LivePreview(width, height);
    assert.deepEqual([f.canvas.width, f.canvas.height], expected); preview.dispose();
  }
});
test('display copies at most ten frames a second from a sixty FPS output', t => {
  const f = fixture(t);
  for (let now = 0; now < 1000; now += 1000 / 60) f.preview.present(f.source, now);
  assert.ok(f.draws() >= 8 && f.draws() <= 10);
});
test('closed and hidden previews do zero draws and resume with the newest source immediately', t => {
  const f = fixture(t); f.preview.present(f.source, 0);
  f.preview.setEnabled(false); assert.equal(f.preview.present(f.source, 200), false);
  f.preview.setVisible(false); f.preview.setEnabled(true); assert.equal(f.preview.present(f.source, 300), false);
  f.preview.setVisible(true); assert.equal(f.preview.present(f.source, 301), true);
  assert.equal(f.draws(), 2);
  f.document.hidden = true; assert.equal(f.preview.present(f.source, 500), false);
  f.document.hidden = false; assert.equal(f.preview.present(f.source, 501), true);
});
test('display disposal releases and detaches its own canvas', t => {
  const f = fixture(t); f.preview.dispose(); assert.equal(f.removed(), true);
  assert.equal(f.canvas.width, 0); assert.equal(f.canvas.height, 0);
});
test('native visibility follows hidden and minimized windows and cleans subscriptions on close', () => {
  const events = new EventEmitter(); let visible = true, minimized = false, destroyed = false;
  const window = Object.assign(events, { isVisible: () => visible, isMinimized: () => minimized, isDestroyed: () => destroyed });
  const states: boolean[] = [];
  const watcher = watchPreviewVisibility(window as unknown as Parameters<typeof watchPreviewVisibility>[0], value => states.push(value));
  watcher.publish(); visible = false; events.emit('hide'); visible = true; events.emit('show');
  minimized = true; events.emit('minimize'); minimized = false; events.emit('restore');
  destroyed = true; watcher.publish(); events.emit('closed');
  assert.deepEqual(states, [true, false, true, false, true, false]);
  for (const name of ['show', 'hide', 'minimize', 'restore', 'closed']) assert.equal(events.listenerCount(name), 0);
});
