import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraBoardAt, cameraBoardMotion, boardSceneForBackdrop } from '../shared/whiteboard/camera-scene';
import { parseBoardRecording } from '../shared/whiteboard/validation';
import { emptyBoard } from '../shared/whiteboard/model';
import type { BoardRecording, BoardCameraAppearance } from '../shared/whiteboard/types';

const camera = { x: .7, y: .7, width: .25, height: .25 };
const appearance: BoardCameraAppearance = { backdrop: 'camera', shade: .4, cameraTransition: { direction: 'enter', duration: 1.1, camera } };
test('camera fills before the mask and ink arrive, with continuous values and an exact settled state', () => {
  const initial = cameraBoardMotion(appearance, 0), middle = cameraBoardMotion(appearance, .4), full = cameraBoardMotion(appearance, 2);
  assert.ok(initial.camera < .0001 && initial.shade < .0001 && initial.ink < .0001);
  assert.ok(middle.camera > initial.camera && middle.camera < 1);
  assert.ok(middle.shade > 0 && middle.shade < .4);
  assert.ok(middle.ink < .0001);
  assert.ok(full.camera > .9999 && Math.abs(full.shade - .4) < .0001 && full.ink > .9999);
});
test('the exit fades ink and mask, then leaves camera mode; streamed appended layouts remain current', () => {
  const recording: BoardRecording = { events: [
    { t: 0, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, ...appearance } },
  ] };
  assert.ok(cameraBoardAt(recording, 2));
  recording.events.push({ t: 3, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 },
    backdrop: 'white', shade: .4, cameraTransition: { direction: 'exit', duration: 1.1, camera } } });
  const exiting = cameraBoardAt(recording, 3.5)!;
  assert.ok(exiting.ink < .0001);
  assert.ok(exiting.camera > 0 && exiting.camera < 1);
  assert.equal(cameraBoardAt(recording, 4.2), undefined);
});
test('new appearance metadata survives storage and rejects invalid opacity, bounds and transition duration', () => {
  const recording = { events: [{ t: 0, action: { kind: 'layout', visible: true, bounds: camera, ...appearance } }] };
  const parsed = parseBoardRecording(recording, 10);
  assert.equal(cameraBoardAt(parsed, 2)?.layout.shade, .4);
  assert.throws(() => parseBoardRecording({ events: [{ t: 0, action: { ...recording.events[0].action, shade: 2 } }] }, 10));
  assert.throws(() => parseBoardRecording({ events: [{ t: 0, action: { ...recording.events[0].action,
    cameraTransition: { direction: 'enter', duration: -1, camera } } }] }, 10));
});
test('switching background keeps ink data and undo history intact while retaining contrast', () => {
  const scene = { ...emptyBoard(), items: [{ kind: 'text' as const, id: 'example', text: '想法', color: '#20242c', size: 24, x: 20, y: 20 }] };
  const onCamera = boardSceneForBackdrop(scene, true);
  assert.equal(onCamera.items[0].color, '#fffaf4'); assert.equal(scene.items[0].color, '#20242c');
  assert.equal(boardSceneForBackdrop(onCamera, false).items[0].color, '#20242c');
  assert.equal(onCamera.undo, scene.undo);
});
