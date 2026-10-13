import assert from 'node:assert/strict';
import test from 'node:test';
import { PanelDrag } from '../electron/services/recorder-launcher/panel-drag';

test('panel drag uses trusted cursor deltas, stops on end and cannot move another window', () => {
  let cursor = { x: -450, y: 125 }, visible = true;
  let bounds = { x: -500, y: 100, width: 700, height: 520 };
  const window = { isDestroyed: () => false, isVisible: () => visible, getBounds: () => bounds,
    setBounds: (next: typeof bounds) => { bounds = next; } };
  let saved: typeof bounds | undefined;
  const drag = new PanelDrag(() => cursor, value => { saved = value; });
  drag.handle('move', window); assert.equal(bounds.x, -500);
  drag.handle('start', window); cursor = { x: -300, y: 180 }; drag.handle('move', window);
  assert.deepEqual(bounds, { x: -350, y: 155, width: 700, height: 520 });
  drag.handle('move', { ...window, setBounds: () => { throw Error('Wrong window'); } });
  drag.handle('end'); cursor = { x: 900, y: 900 }; drag.handle('move', window); assert.equal(bounds.x, -350);
  assert.deepEqual(saved, bounds);
  drag.handle('start', window); drag.handle('move', window); assert.equal(bounds.x, -350, 'Out-of-window start rejected');
  cursor = { x: -300, y: 180 }; drag.handle('start', window); visible = false; drag.handle('move', window);
  visible = true; cursor = { x: -250, y: 200 }; drag.handle('move', window); assert.equal(bounds.x, -350);
  assert.throws(() => drag.handle('arbitrary', window), /无效/);
});

test('fractional display rounding is not fed back as a larger size on the next drag', () => {
  let cursor = { x: 10, y: 10 }, bounds = { x: 0, y: 0, width: 700, height: 520 };
  const window = { isDestroyed: () => false, isVisible: () => true, getBounds: () => bounds,
    setBounds: (value: typeof bounds) => { bounds = { ...value, height: value.height + 1 }; } };
  const drag = new PanelDrag(() => cursor, () => {}, () => ({ width: 700, height: 520 }));
  for (let index = 0; index < 4; index++) {
    drag.handle('start', window); cursor = { x: cursor.x + 10, y: cursor.y + 10 };
    drag.handle('move', window); drag.handle('end');
    assert.equal(bounds.height, 521);
  }
});
