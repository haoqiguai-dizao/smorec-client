import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBoardAction, boardAt, emptyBoard } from '../shared/whiteboard/model';
import { parseBoardAction, parseBoardRecording } from '../shared/whiteboard/validation';
import { boardViewport, DEFAULT_BOARD_VIEW, fitBoardView } from '../shared/whiteboard/viewport';
import { drawRecordedBoard, paintBoard } from '../src/services/whiteboard-renderer';
import type { BoardEvent, BoardShape } from '../shared/whiteboard/types';

const shape: BoardShape = { kind: 'shape', id: 'outside', shape: 'rectangle', color: '#3074e8',
  size: 4, x: -1500, y: 1400, width: 200, height: 100, text: '画布外的内容' };

test('world coordinates survive pan, zoom, undo and backward replay', () => {
  const view = { x: -1400, y: 1450, zoom: 2 };
  const events: BoardEvent[] = [{ t: 0, action: { kind: 'viewport', view: DEFAULT_BOARD_VIEW } },
    { t: 1, action: shape }, { t: 2, action: { kind: 'viewport', view } },
    { t: 3, action: { kind: 'undo' } }, { t: 4, action: { kind: 'redo' } }];
  const recording = parseBoardRecording(JSON.parse(JSON.stringify({ events })), 5);
  assert.deepEqual(boardAt(recording, 2).items, [shape]);
  assert.deepEqual(boardAt(recording, 2).view, view);
  assert.deepEqual(boardAt(recording, 3).items, []);
  assert.deepEqual(boardAt(recording, 3).view, view, 'Undo changes content, not the viewport');
  assert.deepEqual(boardAt(recording, 4).items, [shape]);
  assert.deepEqual(boardAt(recording, 1).view, DEFAULT_BOARD_VIEW);
  const transform = boardViewport(1200, 700, view);
  assert.equal(view.x * transform.scale + transform.left, 600);
  assert.equal(view.y * transform.scale + transform.top, 350);
  assert.deepEqual(fitBoardView([shape]), { x: -1400, y: 1450, zoom: 1 });
  for (const zoom of [0, .09, 8.01, Infinity, NaN])
    assert.throws(() => parseBoardAction({ kind: 'viewport', view: { ...view, zoom } }));
});

test('infinite canvas paints visible world content and culls content outside the viewport', () => {
  const labels: string[] = [], clips: number[][] = [];
  const ctx = new Proxy({}, { set: () => true, get: (_target, key) => key === 'fillText'
    ? (value: string) => labels.push(value) : key === 'rect' ? (...args: number[]) => clips.push(args)
      : key === 'measureText' ? () => ({ width: 80 }) : () => {} }) as CanvasRenderingContext2D;
  const scene = applyBoardAction(emptyBoard(), shape);
  paintBoard(ctx, { ...scene, view: { x: -1400, y: 1450, zoom: 1 } }, 1200, 700);
  assert.deepEqual(labels, [shape.text]);
  assert.deepEqual(clips, [[0, 0, 1200, 700]], 'Only the viewport is clipped, not the old page');
  labels.length = 0;
  paintBoard(ctx, { ...scene, view: DEFAULT_BOARD_VIEW }, 1200, 700);
  assert.deepEqual(labels, []);
});

test('embedded whiteboard is not painted twice and presenter crops it from the screen source', () => {
  const bounds = { x: .1, y: .2, width: .7, height: .6 };
  const recording = parseBoardRecording({ interfaceCapture: 'screen', events: [{ t: 1, action: {
    kind: 'layout', visible: true, bounds, windowBounds: bounds, presentation: 'interface',
  } }] }, 3);
  const draws: unknown[][] = [];
  const ctx = new Proxy({}, { set: () => true, get: (_target, key) => key === 'drawImage'
    ? (...args: unknown[]) => draws.push(args) : () => {} }) as CanvasRenderingContext2D;
  const screen = { width: 2560, height: 1440 } as CanvasImageSource;
  drawRecordedBoard(ctx, recording, 2, 0, 0, 1200, 700);
  assert.equal(draws.length, 0);
  drawRecordedBoard(ctx, recording, 2, 0, 0, 1200, 700, undefined, undefined, screen);
  assert.deepEqual(draws[0], [screen, 256, 288, 1792, 864, 0, 0, 840, 420]);
  assert.throws(() => parseBoardRecording({ ...recording, video: { offset: 0 } }, 3));
  assert.throws(() => parseBoardRecording({ ...recording, interfaceCapture: 'untrusted' }, 3));
});
