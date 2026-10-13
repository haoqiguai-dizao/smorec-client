import assert from 'node:assert/strict';
import test from 'node:test';
import { boardControlInsets } from '../electron/services/whiteboard/geometry';

test('fullscreen camera controls avoid menu bar, visible or auto-hidden Dock in logical pixels', () => {
  const full = { x: 0, y: 0, width: 2304, height: 1296 };
  const work = { x: 0, y: 32, width: 2304, height: 1192 };
  assert.deepEqual(boardControlInsets(full, work, 'darwin'), { top: 40, bottom: 96, left: 8, right: 8 });
  assert.equal(boardControlInsets(full, full, 'darwin').bottom, 96);
  const sideDock = { x: 80, y: 32, width: 2224, height: 1264 };
  assert.equal(boardControlInsets(full, sideDock, 'darwin').left, 88);
});
test('cropped camera areas preserve drawing space and small screens retain enough usable controls', () => {
  const work = { x: 0, y: 32, width: 2304, height: 1192 };
  assert.deepEqual(boardControlInsets({ x: 100, y: 100, width: 800, height: 500 }, work, 'darwin'),
    { top: 8, bottom: 8, left: 8, right: 8 });
  const tiny = boardControlInsets({ x: 0, y: 0, width: 320, height: 250 }, work, 'darwin');
  assert.ok(250 - tiny.top - tiny.bottom >= 180);
});
