import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraAt, cursorAt, generateAutoZooms, getOutputDuration, outputToSourceTime, sourceToOutputTime, splitClip } from '../shared/timeline';
import type { Clip, CursorSample, ZoomSegment } from '../shared/types';

const editedClips: Clip[] = [
  { id: 'first', start: 2, end: 5 },
  { id: 'second', start: 10, end: 14 },
  { id: 'third', start: 20, end: 21 },
];

test('cuts jump to the next source frame exactly at their output boundary', () => {
  assert.equal(getOutputDuration(editedClips), 8);
  assert.equal(outputToSourceTime(editedClips, -1), 2);
  assert.equal(outputToSourceTime(editedClips, 3), 10);
  assert.equal(outputToSourceTime(editedClips, 7), 20);
  assert.equal(outputToSourceTime(editedClips, 100), 21);
  assert.equal(sourceToOutputTime(editedClips, 8), 3);
  assert.equal(sourceToOutputTime(editedClips, 16), 7);
});

test('splitting an edited clip preserves every exported frame source time', () => {
  const fps = 60;
  const split = splitClip(editedClips, 4.5, 1 / fps);
  assert.equal(split.length, 4);
  assert.equal(split[1].start, 10);
  assert.equal(split[1].end, 11.5);
  assert.equal(split[2].start, 11.5);
  assert.equal(split[2].end, 14);
  assert.equal(getOutputDuration(split), getOutputDuration(editedClips));
  for (let frame = 0; frame < getOutputDuration(editedClips) * fps; frame++) {
    assert.ok(Math.abs(outputToSourceTime(split, frame / fps) - outputToSourceTime(editedClips, frame / fps)) < 1e-10);
  }
  assert.equal(editedClips[1].end, 14, 'editing must not alter the undo snapshot');
});

test('splits at cuts and within less than one frame do not create empty clips', () => {
  for (const position of [0, 3, 7, 8, 3 + 1 / 120, 7 - 1 / 120]) {
    assert.equal(splitClip(editedClips, position, 1 / 60), editedClips);
  }
});

test('edge-focused camera never exposes content beyond the captured frame', () => {
  const zoom: ZoomSegment = { id: 'edge', start: 1, end: 3, x: 0, y: 1, scale: 3 };
  assert.deepEqual(cameraAt([zoom], 0), { scale: 1, x: 0.5, y: 0.5 });
  assert.deepEqual(cameraAt([zoom], 1), { scale: 1, x: 0.5, y: 0.5 });
  assert.deepEqual(cameraAt([zoom], 3), { scale: 1, x: 0.5, y: 0.5 });
  for (let frame = 0; frame <= 180; frame++) {
    const camera = cameraAt([zoom], frame / 60);
    const halfViewport = 0.5 / camera.scale;
    assert.ok(camera.x - halfViewport >= -1e-12);
    assert.ok(camera.x + halfViewport <= 1 + 1e-12);
    assert.ok(camera.y - halfViewport >= -1e-12);
    assert.ok(camera.y + halfViewport <= 1 + 1e-12);
  }
});

test('rapid distant clicks produce nonoverlapping zooms confined to the recording', () => {
  const cursor: CursorSample[] = [
    { t: 0.1, x: 0.1, y: 0.1, visible: true, click: true },
    { t: 0.2, x: 0.11, y: 0.11, visible: true, click: true },
    { t: 0.7, x: 0.9, y: 0.9, visible: true, click: true },
    { t: 1.6, x: 0.5, y: 0.5, visible: false, click: true },
  ];
  const zooms = generateAutoZooms(cursor, 2);
  assert.equal(zooms.length, 2);
  assert.ok(zooms[0].start <= 0.1 && zooms[0].end >= 0.2);
  assert.ok(zooms[1].start <= 0.7 && zooms[1].end >= 0.7);
  assert.ok(zooms[0].end <= zooms[1].start);
  assert.ok(zooms.every(zoom => zoom.start >= 0 && zoom.end <= 2));
});

test('smoothing keeps the pointer anchored on the actual click target', () => {
  const cursor: CursorSample[] = [
    { t: 0.9, x: 0, y: 0, visible: true },
    { t: 1, x: 0.8, y: 0.3, visible: true, click: true },
    { t: 1.1, x: 1, y: 1, visible: true },
    { t: 1.2, x: 1, y: 1, visible: false },
  ];
  assert.equal(cursorAt(cursor, 0.5, 1), null);
  const click = cursorAt(cursor, 1, 1);
  assert.equal(click?.x, 0.8);
  assert.equal(click?.y, 0.3);
  assert.equal(cursorAt(cursor, 1.2, 1)?.visible, false);
});
