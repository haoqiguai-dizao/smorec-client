import test from 'node:test';
import assert from 'node:assert/strict';
import { revealWindow, visibleWindowBounds } from '../electron/services/window-visibility';

const primary = { x: 0, y: 0, width: 1920, height: 1040 };
test('keeps an editor already inside its display and restores disconnected-display bounds', () => {
  const normal = { x: 200, y: 60, width: 1440, height: 920 };
  assert.deepEqual(visibleWindowBounds(normal, [primary]), normal);
  assert.deepEqual(visibleWindowBounds({ ...normal, x: -3000 }, [primary]), { ...normal, x: 240, y: 60 });
});
test('fits a small or partly off-screen editor into the correct monitor work area', () => {
  const secondary = { x: -1280, y: 0, width: 1280, height: 680 };
  assert.deepEqual(visibleWindowBounds({ x: -1200, y: 90, width: 1440, height: 920 }, [primary, secondary]),
    { x: -1280, y: 0, width: 1280, height: 680 });
});
test('restores a minimized window, relaxes oversize minimums and reveals it on every explicit call', () => {
  const actions: string[] = [];
  let bounds = { x: 0, y: 0, width: 1440, height: 920 };
  const window = { isDestroyed: () => false, isMinimized: () => true, isVisible: () => true, restore: () => { actions.push('restore'); },
    getBounds: () => bounds, getMinimumSize: () => [1040, 700],
    setMinimumSize: (width: number, height: number) => { actions.push(`minimum:${width}x${height}`); },
    setBounds: (value: typeof bounds) => { bounds = value; actions.push('bounds'); },
    show: () => { actions.push('show'); }, focus: () => { actions.push('focus'); } };
  revealWindow(window, [{ x: 0, y: 0, width: 1024, height: 640 }]);
  assert.deepEqual(actions, ['restore', 'minimum:1024x640', 'bounds', 'show', 'focus']);
  actions.length = 0; revealWindow(window, [{ x: 0, y: 0, width: 1024, height: 640 }]);
  assert.deepEqual(actions, ['restore', 'show', 'focus']);
  window.isDestroyed = () => true; actions.length = 0; revealWindow(window, [primary]);
  assert.deepEqual(actions, []);
});
test('retries a hidden first native show synchronously without a focus timer', () => {
  let shows = 0, focused = false;
  const bounds = { x: 200, y: 60, width: 1440, height: 920 };
  const window = { isDestroyed: () => false, isMinimized: () => false, isVisible: () => shows >= 2,
    restore: () => {}, getBounds: () => bounds, getMinimumSize: () => [1040, 700], setMinimumSize: () => {},
    setBounds: () => {}, show: () => { shows++; }, focus: () => { focused = true; } };
  revealWindow(window, [primary]); assert.equal(shows, 2); assert.equal(focused, true);
});
