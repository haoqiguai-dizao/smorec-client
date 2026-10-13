import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyBoardAction, boardAt, emptyBoard } from '../shared/whiteboard/model';
import { attached, curvePoint, distanceToCurve, elementAt, lineCurve, linePoints, shapeAt } from '../shared/whiteboard/geometry';
import { parseBoardAction, parseBoardRecording } from '../shared/whiteboard/validation';
import type { BoardImage, BoardLine, BoardShape, BoardStroke } from '../shared/whiteboard/types';
import { drawnShape, movedElement, placedRectangle, resizedImage, resizedShape } from '../src/hooks/whiteboard-gestures';
import { connectionPort, edgeAt, handleAt, handleCursor, selectionHandles } from '../src/services/whiteboard-selection';
import { drawRecordedBoard } from '../src/services/whiteboard-renderer';
import { shapeLabel } from '../src/services/whiteboard-text';
import { WhiteboardJournal, readRecordedBoard } from '../electron/services/whiteboard/journal';
import { imageAssets, imageFile } from '../electron/services/whiteboard/images';

const source: BoardShape = { kind: 'shape', id: 's1', shape: 'rectangle', color: '#3074e8', size: 4,
  x: 100, y: 100, width: 200, height: 100, text: '问题' };
const destination: BoardShape = { ...source, id: 's2', shape: 'ellipse', x: 600, text: '下一步' };
const arrow: BoardLine = { kind: 'line', id: 'l1', color: '#20242c', size: 4, arrow: true,
  start: { x: 250, y: 150, shapeId: source.id }, end: { x: 650, y: 150, shapeId: destination.id } };

test('spoken labels wrap in the node without losing their stored transcription', () => {
  assert.deepEqual(shapeLabel('梳理问题', 200, 110).lines, ['梳理问题']);
  const spoken = '我们先确定目标和边界，然后把风险依赖与执行步骤逐项写清楚';
  const label = shapeLabel(spoken, 200, 110);
  assert.ok(label.lines.length > 1 && label.lines.length <= 4);
  assert.ok(label.lines.every(line => line.length > 0));
  assert.ok(label.lines.join('').length <= spoken.length);
});

test('drawing extends beyond the original viewport; arrows attach to moving shapes', () => {
  const circle = drawnShape('circle', 'ellipse', { x: 200, y: 200 }, { x: 200, y: 200 }, '#20242c', 6, true);
  assert.equal(circle.width, circle.height);
  const created = drawnShape('new', 'diamond', { x: 1190, y: 690 }, { x: 1200, y: 700 }, '#20242c', 6);
  assert.ok(created.x + created.width > 1200 && created.y + created.height > 700);
  const resized = resizedShape(source, 'se', { x: 340, y: 230 });
  assert.deepEqual([resized.width, resized.height], [240, 130]);
  const moved = movedElement(destination, 100, 60) as BoardShape;
  assert.equal(shapeAt([source, moved], { x: 750, y: 210 })?.id, destination.id);
  assert.equal(attached({ x: 750, y: 210 }, [source, moved]).shapeId, destination.id);
  assert.equal(elementAt([source, moved, arrow], { x: 200, y: 150 }, 5)?.id, source.id);
  const before = linePoints(arrow, [source, destination]);
  const after = linePoints(arrow, [source, moved]);
  assert.ok(after[1].x > before[1].x && after[1].y > before[1].y);
});

test('selected shapes expose distinct connection ports and a dragged arrow stays on its chosen side', () => {
  const handles = selectionHandles(source, [source]);
  assert.deepEqual(handles['connect-right'], { x: 324, y: 150 });
  assert.equal(handleAt(source, [source], { x: 324, y: 150 }, 10), 'connect-right');
  assert.equal(edgeAt(source, { x: 300, y: 150 }, 10), 'e');
  assert.equal(connectionPort('connect-right'), 'right');
  assert.equal(handleAt(source, [source], { x: 300, y: 100 }, 10), 'ne');
  const fixed = parseBoardAction({ ...arrow, start: { x: 300, y: 150, shapeId: source.id, port: 'right' } }) as BoardLine;
  assert.deepEqual(linePoints(fixed, [source, destination])[0], { x: 300, y: 150 });
  const moved = movedElement(source, 60, 40) as BoardShape;
  assert.deepEqual(linePoints(fixed, [moved, destination])[0], { x: 360, y: 190 });
  const replay = parseBoardRecording({ events: [
    { t: 0, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 } } },
    { t: 1, action: source }, { t: 2, action: destination }, { t: 3, action: fixed },
    { t: 4, action: { kind: 'replace', gesture: 'move', element: moved } },
  ] }, 5);
  const movedScene = boardAt(replay, 4);
  assert.deepEqual(linePoints(movedScene.items[2] as BoardLine, movedScene.items)[0], { x: 360, y: 190 });
  assert.equal(parseBoardAction(arrow).kind, 'line', 'older arrows without a port remain valid');
  assert.throws(() => parseBoardAction({ ...arrow, start: { x: 300, y: 150, port: 'right' } }), /连接点缺少图形/);
  assert.throws(() => parseBoardAction({ ...arrow, start: { x: 300, y: 150, shapeId: source.id, port: 'diagonal' } }), /连接点无效/);
});

test('dragging anywhere along a selected shape edge resizes one axis and attached lines follow', () => {
  assert.equal(edgeAt(source, { x: 250, y: 100 }, 8), 'n');
  assert.equal(edgeAt(source, { x: 300, y: 175 }, 8), 'e');
  assert.equal(edgeAt(source, { x: 175, y: 200 }, 8), 's');
  assert.equal(edgeAt(source, { x: 100, y: 125 }, 8), 'w');
  assert.equal(edgeAt(source, { x: 175, y: 150 }, 8), undefined);
  assert.equal(handleCursor('n'), 'ns-resize');
  assert.equal(handleCursor('e'), 'ew-resize');
  assert.equal(handleCursor('connect-right'), 'crosshair');
  assert.deepEqual(resizedShape(source, 'n', { x: 250, y: 70 }),
    { ...source, y: 70, height: 130 });
  assert.deepEqual(resizedShape(source, 'e', { x: 350, y: 175 }),
    { ...source, width: 250 });
  assert.deepEqual(resizedShape(source, 's', { x: 175, y: 230 }),
    { ...source, height: 130 });
  assert.deepEqual(resizedShape(source, 'w', { x: 70, y: 125 }),
    { ...source, x: 70, width: 230 });
  const link: BoardLine = { ...arrow, start: { x: 300, y: 150, shapeId: source.id, port: 'right' } };
  let scene = [source, destination, link].reduce(applyBoardAction, emptyBoard());
  scene = applyBoardAction(scene, { kind: 'replace', gesture: 'resize-edge',
    element: resizedShape(source, 'e', { x: 350, y: 175 }) });
  assert.deepEqual(linePoints(link, scene.items)[0], { x: 350, y: 150 });
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.deepEqual(linePoints(link, scene.items)[0], { x: 300, y: 150 });
  const atBoundary = { ...source, x: 1000, y: 0 };
  const rightPort = selectionHandles(atBoundary, [atBoundary])['connect-right']!;
  assert.ok(rightPort.x > 1200 && rightPort.y === 50);
  assert.ok(Math.hypot(rightPort.x - 1200, rightPort.y - 50) > 18,
    'connection port remains outside the resize edge across the original viewport boundary');
  assert.equal(handleAt(atBoundary, [atBoundary], rightPort, 10), 'connect-right');
});

test('changing an existing node shape or line arrow preserves links, labels and undo', () => {
  let scene = [source, destination, arrow].reduce(applyBoardAction, emptyBoard());
  const diamond = { ...source, shape: 'diamond' as const };
  scene = applyBoardAction(scene, { kind: 'replace', gesture: 'shape-change', element: diamond });
  assert.equal((scene.items[0] as BoardShape).text, source.text);
  assert.equal((scene.items[0] as BoardShape).shape, 'diamond');
  assert.equal((scene.items[2] as BoardLine).start.shapeId, source.id);
  assert.ok(Number.isFinite(linePoints(arrow, scene.items)[0].x));
  scene = applyBoardAction(scene, { kind: 'replace', gesture: 'line-change', element: { ...arrow, arrow: false } });
  assert.equal((scene.items[2] as BoardLine).arrow, false);
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.equal((scene.items[2] as BoardLine).arrow, true);
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.deepEqual(scene.items, [source, destination, arrow]);
});

test('curved connectors use the same path for paint, hit testing, erasing and moving nodes', () => {
  const lower = { ...destination, y: 360 };
  const line: BoardLine = { ...arrow,
    start: { x: 300, y: 150, shapeId: source.id, port: 'right' },
    end: { x: 600, y: 410, shapeId: lower.id, port: 'left' } };
  const items = [source, lower, line];
  const route = lineCurve(line, items), middle = curvePoint(route, .5);
  assert.notEqual(curvePoint(route, .25).y, route.start.y + (route.end.y - route.start.y) * .25,
    'diagonal connector should bow naturally');
  assert.ok(distanceToCurve(middle, route) < 1);
  assert.equal(elementAt(items, middle, 4)?.id, line.id);
  let scene = items.reduce(applyBoardAction, emptyBoard());
  scene = applyBoardAction(scene, { kind: 'erase', id: 'curve-erase', gesture: 'g', radius: 5, points: [middle] });
  assert.deepEqual(scene.items.map(item => item.id), [source.id, lower.id]);
  const shifted = movedElement(lower, 100, 20) as BoardShape;
  assert.notDeepEqual(lineCurve(line, [source, shifted, line]).end, route.end);
});

test('pasted image is a movable connected node with a caption and reversible deletion', () => {
  const image: BoardImage = { kind: 'image', id: 'photo', asset: '11111111-1111-4111-8111-111111111111',
    color: '#20242c', size: 3, x: 450, y: 270, width: 240, height: 160, caption: '现状截图' };
  assert.deepEqual(parseBoardAction(image), image);
  assert.equal(shapeAt([image], { x: 500, y: 470 })?.id, image.id, 'caption belongs to the node');
  assert.deepEqual(selectionHandles(image, [image])['connect-bottom'], { x: 570, y: 502 });
  const taller = resizedImage(image, 'se', { x: 690, y: 540 });
  assert.ok(taller.width > image.width && taller.height > image.height);
  assert.ok(Math.abs(taller.width / taller.height - image.width / image.height) < .001);
  const line: BoardLine = { ...arrow, end: { x: 450, y: 350, shapeId: image.id, port: 'left' } };
  let scene = [source, image, line].reduce(applyBoardAction, emptyBoard());
  scene = applyBoardAction(scene, { kind: 'replace', gesture: 'move', element: movedElement(image, 60, 20) });
  assert.deepEqual(linePoints(line, scene.items)[1], { x: 510, y: 406 });
  scene = applyBoardAction(scene, { kind: 'delete', id: image.id });
  assert.deepEqual(scene.items.map(item => item.id), [source.id]);
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.deepEqual(scene.items.map(item => item.id), [source.id, image.id, line.id]);
  assert.throws(() => parseBoardAction({ ...image, asset: '../screen.mp4' }));
});

test('image references stay compact in events and resolve only validated project assets', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const image: BoardImage = { kind: 'image', id: 'photo', asset: id, color: '#20242c', size: 3,
    x: 100, y: 100, width: 200, height: 120, caption: '说明' };
  const recording = parseBoardRecording({ events: [{ t: 1, action: image },
    { t: 2, action: { kind: 'replace', gesture: 'move', element: { ...image, x: 200 } } }] }, 3);
  assert.deepEqual(imageAssets(recording), [id]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-board-image-'));
  try {
    const folder = path.join(directory, 'whiteboard-assets'); await fs.mkdir(folder);
    const file = path.join(folder, `${id}.png`);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lV0AAAAASUVORK5CYII=', 'base64');
    await fs.writeFile(file, png);
    assert.equal(await imageFile(directory, id), await fs.realpath(file));
    await fs.rm(file);
    await fs.rmdir(folder);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-board-outside-'));
    try {
      await fs.writeFile(path.join(outside, `${id}.png`), png);
      await fs.symlink(outside, folder, process.platform === 'win32' ? 'junction' : 'dir');
      assert.equal((await fs.lstat(folder)).isSymbolicLink(), true);
      await assert.rejects(imageFile(directory, id), /白板图片文件无效/);
    } finally { await fs.unlink(folder); await fs.rm(outside, { recursive: true, force: true }); }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('dropping a connection on blank space creates a linked node as one undoable action', () => {
  const node = placedRectangle('new-node', { x: 600, y: 350 }, '#3074e8', 4);
  assert.deepEqual([node.x, node.y, node.width, node.height], [500, 295, 200, 110]);
  const edge = placedRectangle('edge-node', { x: 1195, y: 690 }, '#3074e8', 4);
  assert.deepEqual([edge.x, edge.y], [1095, 635]);
  const line: BoardLine = { ...arrow, start: { x: 300, y: 150, shapeId: source.id, port: 'right' },
    end: { x: 600, y: 350, shapeId: node.id } };
  const action = parseBoardAction({ kind: 'connect-node', line, node });
  let scene = applyBoardAction(emptyBoard(), source);
  scene = applyBoardAction(scene, { ...line, end: { x: 600, y: 350 } });
  scene = applyBoardAction(scene, action);
  assert.deepEqual(scene.items.map(item => item.id), [source.id, line.id, node.id]);
  assert.deepEqual(linePoints(scene.items[1] as BoardLine, scene.items)[1], { x: 500, y: 300 });
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.deepEqual(scene.items, [source], 'undo removes the arrow and generated node together');
  assert.throws(() => parseBoardAction({ kind: 'connect-node', line: { ...line, end: { x: 600, y: 350 } }, node }), /新节点连线无效/);
});

test('source-time replay and common painter include node labels, anchored arrows and later erasure', () => {
  const recording = parseBoardRecording({ events: [
    { t: 0, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 } } },
    { t: 1, action: source }, { t: 2, action: destination }, { t: 3, action: arrow },
    { t: 4, action: { kind: 'replace', gesture: 'move', element: { ...destination, x: 700 } } },
    { t: 5, action: { kind: 'erase', id: 'e1', gesture: 'rub', radius: 30,
      points: [{ x: 800, y: 150 }] } },
  ] }, 6);
  assert.equal(boardAt(recording, 2).items.length, 2);
  assert.equal(boardAt(recording, 3).items.length, 3);
  assert.equal((boardAt(recording, 4).items[1] as BoardShape).x, 700);
  assert.deepEqual(boardAt(recording, 5).items.map(item => item.id), [source.id]);
  const words: string[] = [], calls: string[] = [];
  const ctx = new Proxy({}, { set: () => true, get: (_target, key) => key === 'fillText'
    ? (word: string) => words.push(word) : key === 'lineTo' ? () => calls.push('line') : () => {} }) as CanvasRenderingContext2D;
  drawRecordedBoard(ctx, recording, 3, 0, 0, 1200, 700);
  assert.deepEqual(words, ['问题', '下一步']); assert.ok(calls.length > 1);
  words.length = 0; drawRecordedBoard(ctx, recording, 5, 0, 0, 1200, 700);
  assert.deepEqual(words, ['问题']);
});

test('large eraser segments a stroke without leaving a bridge; old white-ink projects remain readable', () => {
  const stroke: BoardStroke = { kind: 'stroke', id: 'ink', color: '#20242c', size: 6,
    points: [{ x: 100, y: 300 }, { x: 700, y: 300 }] };
  let scene = applyBoardAction(emptyBoard(), stroke);
  scene = applyBoardAction(scene, { kind: 'erase', id: 'erase-1', gesture: 'rub', radius: 32,
    points: [{ x: 400, y: 300 }] });
  assert.equal(scene.items.length, 2);
  const [left, right] = scene.items as BoardStroke[];
  assert.ok(left.points.at(-1)!.x < 400 - 32 && right.points[0].x > 400 + 32);
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.deepEqual(scene.items, [stroke]);
  const legacy = parseBoardAction({ ...stroke, id: 'old-eraser', color: '#ffffff' });
  assert.equal(legacy.kind, 'stroke');
});

test('a continuous erase is one undo step and new diagram actions survive the recording journal', async () => {
  let scene = applyBoardAction(emptyBoard(), source);
  scene = applyBoardAction(scene, destination);
  scene = applyBoardAction(scene, arrow);
  scene = applyBoardAction(scene, { kind: 'erase', id: 'e1', gesture: 'rub', radius: 20,
    points: [{ x: 820, y: 150 }] });
  scene = applyBoardAction(scene, { kind: 'erase', id: 'e2', gesture: 'rub', radius: 20,
    points: [{ x: 190, y: 150 }] });
  assert.deepEqual(scene.items, []);
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.deepEqual(scene.items, [source, destination, arrow]);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-diagram-'));
  try {
    const journal = new WhiteboardJournal(); await journal.reset(directory); journal.start(1000);
    await journal.append({ kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 } }, 1000);
    await journal.append(source, 2000);
    await journal.append(destination, 2500);
    await journal.append(arrow, 3000);
    await journal.append({ kind: 'replace', gesture: 'move', element: { ...destination, x: 700 } }, 4000);
    await journal.flush();
    const recording = await readRecordedBoard(directory, 5);
    assert.deepEqual(recording?.events.map(event => event.action.kind),
      ['layout', 'shape', 'shape', 'line', 'replace']);
    assert.equal((boardAt(recording!, 4).items[1] as BoardShape).x, 700);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
