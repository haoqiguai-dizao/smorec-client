import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBoardAction } from '../shared/whiteboard/validation';
import { applyBoardAction, emptyBoard } from '../shared/whiteboard/model';
import { linePoints, shapeAt } from '../shared/whiteboard/geometry';
import type { BoardLine, BoardShape } from '../shared/whiteboard/types';

test('borderless text nodes retain connections during movement, deletion and undo', () => {
  const text: BoardShape = { kind: 'shape', shape: 'text', id: 'text', x: 20, y: 30, width: 160, height: 80,
    color: '#20242c', size: 6, text: '可连线的纯文字' };
  const other = { ...text, id: 'other', shape: 'ellipse' as const, x: 400 };
  const line: BoardLine = { kind: 'line', id: 'line', start: { x: 180, y: 70, shapeId: 'text', port: 'right' },
    end: { x: 400, y: 70, shapeId: 'other', port: 'left' }, arrow: true, color: '#e5484d', size: 6 };
  assert.deepEqual(parseBoardAction(text), text);
  let scene = [text, other, line].reduce(applyBoardAction, emptyBoard());
  assert.equal(shapeAt(scene.items, { x: 50, y: 60 })?.id, text.id);
  scene = applyBoardAction(scene, { kind: 'replace', gesture: 'move', element: { ...text, x: 100 } });
  assert.deepEqual(linePoints(line, scene.items)[0], { x: 260, y: 70 });
  scene = applyBoardAction(scene, { kind: 'delete', id: text.id });
  assert.equal(scene.items.length, 1);
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.equal(scene.items.length, 3); assert.deepEqual(linePoints(line, scene.items)[0], { x: 260, y: 70 });
});
