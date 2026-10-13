import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyBoardAction, boardAt, emptyBoard } from '../shared/whiteboard/model';
import { parseBoardAction, parseBoardRecording } from '../shared/whiteboard/validation';
import type { BoardEvent, BoardStroke } from '../shared/whiteboard/types';
import { WhiteboardJournal, readRecordedBoard } from '../electron/services/whiteboard/journal';
import { boardBounds, boardWindowBounds, clampBoard, recordingArea } from '../electron/services/whiteboard/geometry';
import { parseProject } from '../electron/services/validation';
import { DEFAULT_STYLE } from '../shared/constants';
import { renderFrame } from '../src/services/compositor';
import { linePoints } from '../shared/whiteboard/geometry';
import type { BoardLine, BoardShape } from '../shared/whiteboard/types';

const stroke: BoardStroke = { kind: 'stroke', id: 'a', color: '#20242c', size: 6, points: [{ x: 10, y: 20 }] };
const bounds = { x: .1, y: .2, width: .7, height: .6 };
const events: BoardEvent[] = [
  { t: 1, action: { kind: 'layout', visible: true, bounds } },
  { t: 2, action: stroke },
  { t: 3, action: { ...stroke, points: [{ x: 30, y: 40 }] } },
  { t: 4, action: { kind: 'undo' } },
  { t: 5, action: { kind: 'redo' } },
  { t: 6, action: { kind: 'layout', visible: false, bounds } },
  { t: 7, action: { kind: 'layout', visible: true, bounds } },
];

test('whiteboard strokes appear over time, undo as one gesture, survive hiding, and replay after seeking', () => {
  const recording = { events };
  assert.equal(boardAt(recording, .5).visible, false);
  assert.equal(boardAt(recording, 2).items.length, 1);
  assert.equal((boardAt(recording, 2).items[0] as BoardStroke).points.length, 1);
  assert.equal((boardAt(recording, 3).items[0] as BoardStroke).points.length, 2);
  assert.equal(boardAt(recording, 4).items.length, 0);
  assert.equal((boardAt(recording, 5).items[0] as BoardStroke).points.length, 2);
  assert.equal(boardAt(recording, 6).visible, false);
  assert.equal(boardAt(recording, 7).items.length, 1);
  assert.equal((boardAt(recording, 2).items[0] as BoardStroke).points.length, 1);
});

test('typing updates one undo unit; clearing is reversible and a new gesture invalidates redo', () => {
  const text = { kind: 'text' as const, id: 'text', color: '#3074e8', size: 32, x: 20, y: 40, text: '你' };
  let scene = applyBoardAction(emptyBoard(), text);
  scene = applyBoardAction(scene, { ...text, text: '你好' });
  assert.equal(scene.items.length, 1); assert.equal(scene.undo.length, 1);
  scene = applyBoardAction(scene, { kind: 'clear' }); assert.equal(scene.items.length, 0);
  scene = applyBoardAction(scene, { kind: 'undo' }); assert.deepEqual(scene.items, [{ ...text, text: '你好' }]);
  scene = applyBoardAction(scene, stroke); assert.equal(scene.redo.length, 0);
});

test('a voice focus event persists without changing whiteboard content or undo history', () => {
  const action = parseBoardAction({ kind: 'focus', point: { x: 220, y: 310 } });
  assert.deepEqual(action, { kind: 'focus', point: { x: 220, y: 310 } });
  assert.throws(() => parseBoardAction({ kind: 'focus', point: { x: -1_000_001, y: 310 } }));
  const scene = applyBoardAction(emptyBoard(), stroke);
  assert.equal(applyBoardAction(scene, action), scene);
  const recording = { events: [{ t: 1, action: { kind: 'layout' as const, visible: true, bounds } },
    { t: 2, action }, { t: 3, action: stroke }] };
  assert.deepEqual(boardAt(recording, 2).items, []);
  assert.deepEqual(boardAt(recording, 3).items, [stroke]);
});

test('window-local pointer focus is validated and never changes whiteboard content', () => {
  const action = parseBoardAction({ kind: 'focus', space: 'window', point: { x: .25, y: .75 } });
  assert.deepEqual(action, { kind: 'focus', space: 'window', point: { x: .25, y: .75 } });
  assert.equal(applyBoardAction(emptyBoard(), action).items.length, 0);
  assert.throws(() => parseBoardAction({ kind: 'focus', space: 'window', point: { x: 1.1, y: .5 } }));
  assert.throws(() => parseBoardAction({ kind: 'focus', space: 'screen', point: { x: .5, y: .5 } }));
  const recording = parseBoardRecording({ events: [{ t: 1, action: { kind: 'layout', visible: true,
    bounds, windowBounds: bounds, presentation: 'interface' } }, { t: 2, action }] }, 3);
  assert.deepEqual(recording.events[1].action, action);
});

test('shapes keep attached arrows while moving; one drag is one undo step', () => {
  const first: BoardShape = { kind: 'shape', id: 'first', shape: 'rectangle', color: '#3074e8', size: 4,
    x: 100, y: 100, width: 200, height: 100, text: '问题' };
  const second: BoardShape = { ...first, id: 'second', shape: 'diamond', x: 600, text: '判断' };
  const line: BoardLine = { kind: 'line', id: 'arrow', color: '#20242c', size: 4,
    start: { x: 300, y: 150, shapeId: first.id }, end: { x: 600, y: 150, shapeId: second.id }, arrow: true };
  let scene = [first, second, line].reduce(applyBoardAction, emptyBoard());
  const original = linePoints(line, scene.items);
  scene = applyBoardAction(scene, { kind: 'replace', gesture: 'drag', element: { ...second, x: 700 } });
  scene = applyBoardAction(scene, { kind: 'replace', gesture: 'drag', element: { ...second, x: 720 } });
  assert.equal(scene.undo.length, 4);
  assert.notDeepEqual(linePoints(line, scene.items), original);
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.deepEqual(linePoints(line, scene.items), original);
  assert.equal((scene.items[1] as BoardShape).x, 600);
  scene = applyBoardAction(scene, { kind: 'redo' });
  assert.equal((scene.items[1] as BoardShape).x, 720);
});

test('wide eraser splits ink without bridging, removes whole shapes and attached lines, and undoes once', () => {
  const ink: BoardStroke = { ...stroke, points: [{ x: 100, y: 200 }, { x: 400, y: 200 }] };
  const shape: BoardShape = { kind: 'shape', id: 'box', shape: 'ellipse', color: '#3074e8', size: 4,
    x: 500, y: 100, width: 150, height: 120, text: '下一步' };
  const line: BoardLine = { kind: 'line', id: 'link', color: '#3074e8', size: 4,
    start: { x: 400, y: 200 }, end: { x: 500, y: 160, shapeId: 'box' }, arrow: true };
  let scene = [ink, shape, line].reduce(applyBoardAction, emptyBoard());
  scene = applyBoardAction(scene, { kind: 'erase', id: 'erase-1', gesture: 'erase', radius: 30, points: [{ x: 250, y: 200 }] });
  assert.equal(scene.items.filter(item => item.kind === 'stroke').length, 2);
  const parts = scene.items.filter((item): item is BoardStroke => item.kind === 'stroke');
  assert.ok(parts[0].points.at(-1)!.x < parts[1].points[0].x);
  scene = applyBoardAction(scene, { kind: 'erase', id: 'erase-2', gesture: 'erase', radius: 30, points: [{ x: 575, y: 160 }] });
  assert.equal(scene.items.filter(item => item.kind !== 'stroke').length, 0);
  scene = applyBoardAction(scene, { kind: 'undo' });
  assert.equal(scene.items.length, 3);
});

test('whiteboard parser rejects invalid IPC payloads, timestamps, coordinates and colors', () => {
  assert.throws(() => parseBoardAction({ ...stroke, color: 'url(x)' }));
  assert.throws(() => parseBoardAction({ ...stroke, points: [{ x: NaN, y: 1 }] }));
  assert.throws(() => parseBoardAction({ ...stroke, points: Array(257).fill({ x: 1, y: 1 }) }));
  assert.throws(() => parseBoardAction({ kind: 'shape', id: 'box', shape: 'rectangle', color: '#20242c', size: 4,
    x: 999_990, y: 0, width: 50, height: 100, text: '' }));
  assert.throws(() => parseBoardAction({ kind: 'erase', id: 'a', gesture: 'g', radius: 20_001, points: [{ x: 1, y: 2 }] }));
  assert.throws(() => parseBoardRecording({ events: [...events].reverse() }, 10));
  assert.throws(() => parseBoardRecording({ events: [{ t: 0, action: { kind: 'layout', visible: true, bounds: { ...bounds, x: .9 } } }] }, 10));
  assert.deepEqual(parseBoardRecording({ events }, 10), { events });
});

test('journal persists ordered events, recovers complete crash-log lines, and isolates successive recordings', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-whiteboard-'));
  try {
    const journal = new WhiteboardJournal(); await journal.reset(directory);
    const session = journal.session;
    assert.throws(() => journal.append(stroke));
    journal.start(1000);
    await Promise.all([journal.append(stroke, 2000), journal.append({ kind: 'undo' }, 1900)]);
    await journal.flush();
    await fs.appendFile(path.join(directory, 'whiteboard.jsonl'), '{"t":');
    const recovered = await readRecordedBoard(directory, 5);
    assert.deepEqual(recovered?.events.map(e => e.t), [1, 1]);
    assert.equal(boardAt(recovered!, 5).items.length, 0);
    const next = path.join(directory, 'next'); await fs.mkdir(next); await journal.reset(next);
    assert.notEqual(journal.session, session); assert.deepEqual(journal.events, []);
    assert.equal(await readRecordedBoard(next, 5), undefined);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('journal surfaces write failures and refuses symbolic links on recovery', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-whiteboard-'));
  try {
    const journal = new WhiteboardJournal(); await journal.reset(path.join(directory, 'missing')); journal.start(0);
    await assert.rejects(journal.append(stroke)); await assert.rejects(journal.flush());
    const other = path.join(directory, 'other'), link = path.join(directory, 'whiteboard.jsonl');
    if (process.platform === 'win32') await fs.mkdir(other); else await fs.writeFile(other, '');
    await fs.symlink(other, link, process.platform === 'win32' ? 'junction' : 'file');
    assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
    await assert.rejects(readRecordedBoard(directory, 5));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('board placement maps Retina crop coordinates and excludes its control strip', () => {
  const area = recordingArea({ id: 's', kind: 'screen', name: 'screen', width: 3000, height: 2000 },
    { sourceId: 's', fps: 30, microphone: false, systemAudio: false, crop: { x: 200, y: 100, width: 1600, height: 1200 } },
    { x: -1500, y: 0, width: 1500, height: 1000 });
  assert.deepEqual(area, { x: -1400, y: 50, width: 800, height: 600 });
  const clamped = clampBoard({ x: -1700, y: -40, width: 400, height: 400 }, area);
  assert.deepEqual(clamped, { x: -1400, y: 50, width: 400, height: 400 });
  // The drawing surface sits below the header and above the floating tool dock.
  assert.deepEqual(boardBounds(clamped, area), { x: 0, y: 36 / 600, width: .5, height: 292 / 600 });
  assert.deepEqual(boardWindowBounds(clamped, area), { x: 0, y: 0, width: .5, height: 400 / 600 });
  const fractional = { x: 10.2, y: 20.4, width: 801.7, height: 603.3 };
  const normalized = boardBounds(clampBoard({ x: 0, y: 0, width: 2000, height: 2000 }, fractional), fractional);
  assert.equal(normalized.x, 0);
  assert.equal(normalized.width, 1);
  assert.deepEqual(boardBounds(clampBoard({ x: 0, y: 0, width: 2000, height: 2000 }, fractional), fractional, true),
    boardWindowBounds(clampBoard({ x: 0, y: 0, width: 2000, height: 2000 }, fractional), fractional),
    'expanded canvas follows its actual window inside the capture area');
  assert.doesNotThrow(() => parseBoardRecording({ events: [{ t: 0, action: { kind: 'layout', visible: true, bounds: normalized } }] }, 1));
  assert.throws(() => parseBoardRecording({ events: [{ t: 0, action: { kind: 'layout', visible: true,
    bounds: normalized, windowBounds: { x: .9, y: 0, width: .2, height: .5 } } }] }, 1));
});

test('project round-trip retains the board and shared compositor paints source-time content for preview/export', () => {
  const project = parseProject({ id: 'f7a810b0-c63e-49ba-acaa-3e381f22c822', name: '白板验证', createdAt: '2026-09-27T00:00:00Z',
    duration: 10, width: 1200, height: 700, fps: 30, media: { screen: 'screen.mp4' }, cursor: [],
    clips: [{ id: 'clip', start: 0, end: 10 }], zooms: [], style: { ...DEFAULT_STYLE, padding: 0, aspect: 'auto', showCursor: false },
    audio: { system: 1, microphone: 1 }, whiteboard: { events: [...events, { t: 8, action: {
      kind: 'text', id: 't', color: '#20242c', size: 32, x: 10, y: 20, text: '白板进入成片',
    } }] } });
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(project))).whiteboard, project.whiteboard);
  const calls: string[] = [];
  const ctx = new Proxy({}, { set: () => true, get: (_target, key) => key === 'fillText'
    ? (text: string) => calls.push(text) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} }) as CanvasRenderingContext2D;
  renderFrame(ctx, {} as CanvasImageSource, project, 8, 1200, 700);
  assert.deepEqual(calls, ['白板进入成片']); calls.length = 0;
  renderFrame(ctx, {} as CanvasImageSource, project, 6, 1200, 700);
  assert.deepEqual(calls, []);
});

test('recorded whiteboard follows the same focused camera transform as the screen', () => {
  const project = parseProject({ id: 'f7a810b0-c63e-49ba-acaa-3e381f22c822', name: '白板镜头', createdAt: '2026-09-27T00:00:00Z',
    duration: 10, width: 1200, height: 700, fps: 30, media: { screen: 'screen.mp4' }, cursor: [],
    clips: [{ id: 'clip', start: 0, end: 10 }], zooms: [{ id: 'focus', start: 1, end: 5,
      x: .75, y: .5, scale: 1.7 }], style: { ...DEFAULT_STYLE, padding: 0, aspect: 'auto', showCursor: false },
    audio: { system: 1, microphone: 1 }, whiteboard: { events } });
  const translations: Array<[number, number]> = [];
  const ctx = new Proxy({}, { set: () => true, get: (_target, key) => key === 'translate'
    ? (x: number, y: number) => translations.push([x, y])
    : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} }) as CanvasRenderingContext2D;
  renderFrame(ctx, {} as CanvasImageSource, project, 2.5, 1200, 700);
  assert.ok(Math.abs(translations[0][0] + 636) < .001 && Math.abs(translations[0][1] + 7) < .001,
    'board origin moves with the focused source frame and the camera edge clamp');
  translations.length = 0;
  renderFrame(ctx, {} as CanvasImageSource, { ...project, zooms: [] }, 2.5, 1200, 700);
  assert.deepEqual(translations[0], [120, 140], 'without a shot the board stays in its recorded position');
});
