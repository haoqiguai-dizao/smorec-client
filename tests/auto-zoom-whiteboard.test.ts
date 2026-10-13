import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraAt, generateAutoZooms } from '../shared/timeline';
import { whiteboardFocusActivity } from '../shared/auto-zoom/whiteboard';
import type { BoardRecording, BoardShape } from '../shared/whiteboard/types';

const bounds = { x: 0, y: 0, width: 1, height: 1 };
const left: BoardShape = { kind: 'shape', id: 'left', shape: 'rectangle', color: '#20242c', size: 4,
  x: 80, y: 200, width: 220, height: 120, text: '第一步' };
const right: BoardShape = { ...left, id: 'right', x: 900, text: '第二步' };
const board: BoardRecording = { events: [
  { t: 1, action: { kind: 'layout', visible: true, bounds } },
  { t: 2, action: left },
  { t: 4, action: right },
  { t: 7, action: { kind: 'layout', visible: false, bounds } },
] };

test('manual whiteboard nodes create distinct camera shots and restore screen framing on close', () => {
  const cursor = [
    { t: 2.1, x: .5, y: .95, click: true, visible: true }, // Excluded floating toolbar.
    { t: 8.5, x: .5, y: .5, click: true, visible: true },
  ];
  const zooms = generateAutoZooms(cursor, 14, undefined, { whiteboard: board, width: 1200, height: 700 });
  assert.equal(zooms.length, 3);
  assert.ok(zooms[0].x < .25);
  assert.ok(zooms[1].x > .75);
  assert.equal(cameraAt(zooms, 3).scale, 1.7);
  assert.equal(cameraAt(zooms, 5).scale, 1.7);
  assert.equal(cameraAt(zooms, 7.8).scale, 1);
  assert.ok(zooms[2].start >= 8, 'screen click after hiding the board remains a screen shot');
});

test('voice hold stays focused before recognition writes text and does not change board content', () => {
  const recording: BoardRecording = { events: [
    { t: 1, action: { kind: 'layout', visible: true, bounds } },
    { t: 2, action: { kind: 'focus', point: { x: 900, y: 280 } } },
    { t: 3.2, action: { kind: 'focus', point: { x: 900, y: 280 } } },
    { t: 4.4, action: { kind: 'focus', point: { x: 900, y: 280 } } },
    { t: 5.2, action: right },
  ] };
  const zooms = generateAutoZooms([], 10, undefined, { whiteboard: recording, width: 1200, height: 700 });
  assert.equal(zooms.length, 1);
  assert.equal(cameraAt(zooms, 4).scale, 1.7);
  assert.ok(zooms[0].end >= 7);
  assert.equal(recording.events.length, 5);
});

test('native typing from an excluded whiteboard window cannot override its node focus', () => {
  const zooms = generateAutoZooms([], 10,
    [{ t: 2.1, kind: 'typing', focus: { x: .98, y: .98 } },
      { t: 8.1, kind: 'typing', focus: { x: .5, y: .5 } }],
    { whiteboard: board, width: 1200, height: 700 });
  assert.equal(zooms.length, 3);
  assert.ok(zooms[0].x < .25 && zooms[1].x > .75);
  assert.equal(zooms[2].x, .5);
});

test('screen interaction outside a floating whiteboard still gets its own camera shot', () => {
  const floating: BoardRecording = { events: [
    { t: 1, action: { kind: 'layout', visible: true,
      bounds: { x: .1, y: .2, width: .4, height: .4 },
      windowBounds: { x: .1, y: .15, width: .4, height: .55 } } },
    { t: 2, action: { kind: 'focus', point: { x: 600, y: 350 } } },
  ] };
  const cursor = [{ t: 3, x: .2, y: .18, click: true, visible: true }, // Overlay header.
    { t: 4, x: .85, y: .8, click: true, visible: true }];
  const zooms = generateAutoZooms(cursor, 10, undefined, { whiteboard: floating, width: 1200, height: 700 });
  assert.equal(zooms.length, 2);
  assert.equal(zooms[0].x, .3);
  assert.equal(zooms[1].x, .85);
});

test('board focus uses the visible sheet letterbox and ignores actions while hidden', () => {
  const recording: BoardRecording = { events: [
    { t: .5, action: left },
    { t: 1, action: { kind: 'layout', visible: true, bounds: { x: .1, y: .1, width: .5, height: .5 } } },
    { t: 2, action: { kind: 'focus', point: { x: 600, y: 350 } } },
    { t: 3, action: { kind: 'layout', visible: false, bounds } },
    { t: 4, action: right },
  ] };
  const activity = whiteboardFocusActivity(recording, 8, 1200, 700);
  assert.deepEqual(activity, [
    { t: 1, kind: 'reset' },
    { t: 2, kind: 'typing', focus: { x: .35, y: .35 } },
    { t: 3, kind: 'reset' },
  ]);
  assert.deepEqual(generateAutoZooms([], 8, undefined, { width: 1200, height: 700 }), []);
});

test('complete interface follows toolbar clicks, selection clicks and a held voice target', () => {
  const windowBounds = { x: .1, y: .1, width: .8, height: .8 };
  const recording: BoardRecording = { events: [
    { t: 1, action: { kind: 'layout', visible: true, bounds: windowBounds,
      windowBounds, presentation: 'interface' } },
    { t: 2, action: { kind: 'focus', space: 'window', point: { x: .25, y: .9 } } }, // Toolbar.
    { t: 3, action: { kind: 'focus', space: 'window', point: { x: .75, y: .35 } } }, // Selection only.
    { t: 4, action: { kind: 'focus', point: { x: 900, y: 280 } } }, // Voice starts before recognition.
    { t: 5.2, action: { kind: 'focus', point: { x: 900, y: 280 } } },
    { t: 6.4, action: { kind: 'focus', point: { x: 900, y: 280 } } },
    { t: 7, action: right },
    { t: 9, action: { kind: 'layout', visible: false, bounds: windowBounds,
      windowBounds, presentation: 'interface' } },
  ] };
  const activity = whiteboardFocusActivity(recording, 14, 1200, 700);
  assert.equal(activity[1].t, 2);
  assert.ok(Math.abs(activity[1].focus!.x - .3) < 1e-9 && Math.abs(activity[1].focus!.y - .82) < 1e-9);
  assert.equal(activity[2].t, 3);
  assert.ok(Math.abs(activity[2].focus!.x - .7) < 1e-9 && Math.abs(activity[2].focus!.y - .38) < 1e-9);
  const zooms = generateAutoZooms([{ t: 10, x: .5, y: .5, click: true, visible: true }],
    14, undefined, { whiteboard: recording, width: 1200, height: 700 });
  assert.ok(zooms.some(zoom => Math.abs(zoom.x - .3) < .01 && zoom.y > .8), 'toolbar click has a shot');
  assert.ok(zooms.some(zoom => Math.abs(zoom.x - .7) < .01 && zoom.y < .5), 'selection click has a shot');
  assert.equal(cameraAt(zooms, 6).scale, 1.7, 'voice hold keeps the camera near the rectangle');
  assert.equal(cameraAt(zooms, 9.5).scale, 1, 'hiding the board returns to full view');
  assert.ok(zooms.some(zoom => zoom.start >= 9.5 && zoom.x === .5), 'later screen clicks still focus');
});

test('complete interface also focuses legacy content actions and keeps toolbar focus through viewport changes', () => {
  const recording: BoardRecording = { events: [
    { t: 1, action: { kind: 'layout', visible: true, bounds,
      windowBounds: bounds, presentation: 'interface' } },
    { t: 2, action: { kind: 'focus', space: 'window', point: { x: .25, y: .9 } } },
    { t: 2.1, action: { kind: 'viewport', view: { x: 600, y: 350, zoom: 1.25 } } },
    { t: 6, action: left },
  ] };
  const zooms = generateAutoZooms([], 10, undefined, { whiteboard: recording, width: 1200, height: 700 });
  assert.equal(zooms.length, 2);
  assert.equal(cameraAt(zooms, 3).scale, 1.7);
  assert.ok(zooms[1].x < .25, 'content action still focuses when older recordings have no pointer event');
});
