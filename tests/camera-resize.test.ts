import assert from 'node:assert/strict';
import test from 'node:test';
import { CameraSizeDispatcher, cameraResizeSize, type CameraResizeEdge, type CameraResizeStart } from '../src/services/camera-resize';

const start = (edge: CameraResizeEdge, patch: Partial<CameraResizeStart> = {}): CameraResizeStart => ({
  edge, size: .22, width: 232, height: 232, screenX: -1000, screenY: 300, ...patch,
});
test('camera edge and corner drags scale around a stable center in screen coordinates', () => {
  for (const [edge, dx, dy] of [['e', 20, 0], ['w', -20, 0], ['n', 0, -20], ['s', 0, 20],
    ['se', 20, 20], ['sw', -20, 20], ['ne', 20, -20], ['nw', -20, -20]] as [CameraResizeEdge, number, number][]) {
    assert.equal(cameraResizeSize(start(edge), -1000 + dx, 300 + dy), .26);
    assert.equal(cameraResizeSize(start(edge), -1000 - dx, 300 - dy), .18);
  }
  assert.equal(cameraResizeSize(start('e'), -980, -30000), .26, 'Orthogonal pointer movement cannot distort aspect');
});
test('portrait and landscape resizing use inner image dimensions, never the expanded settings window', () => {
  for (const aspect of [3 / 4, 1, 1.25, 16 / 9]) {
    const gesture = start('se', { height: 220 / aspect + 12 });
    assert.equal(cameraResizeSize(gesture, -980, 300 + 20 / aspect), .26);
  }
  assert.equal(cameraResizeSize(start('e'), 99999, 300), .42);
  assert.equal(cameraResizeSize(start('e'), -99999, 300), .12);
  assert.equal(cameraResizeSize(start('e'), Number.NaN, 300), .22);
  assert.equal(cameraResizeSize(start('e'), -1000, 300), .22);
});
test('camera size dispatch coalesces pending motion but preserves the final size and strict IPC order', async () => {
  const values: number[] = [], release: (() => void)[] = [];
  const dispatcher = new CameraSizeDispatcher(value => {
    values.push(value); return new Promise<void>(resolve => release.push(resolve));
  });
  dispatcher.update(.23); dispatcher.update(.24); dispatcher.update(.25); dispatcher.update(.26);
  assert.deepEqual(values, [.23]); release.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(values, [.23, .26]); release.shift()!();
  await new Promise(resolve => setImmediate(resolve));
  dispatcher.update(.22); assert.deepEqual(values, [.23, .26, .22]); release.shift()!(); dispatcher.stop();
});
test('camera resize shutdown discards unsent work and a failed control cannot create an unhandled retry loop', async () => {
  const values: number[] = []; let release!: () => void;
  const dispatcher = new CameraSizeDispatcher(value => { values.push(value); return new Promise<void>(resolve => { release = resolve; }); });
  dispatcher.update(.23); dispatcher.update(.28); dispatcher.stop(); release();
  await new Promise(resolve => setImmediate(resolve)); dispatcher.update(.4);
  assert.deepEqual(values, [.23]);
  const rejected = new CameraSizeDispatcher(async value => { values.push(value); throw new Error('Closed session'); });
  rejected.update(.3); await new Promise(resolve => setImmediate(resolve)); rejected.update(.4);
  assert.deepEqual(values, [.23, .3]);
});
