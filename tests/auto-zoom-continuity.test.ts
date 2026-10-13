import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraAt, generateAutoZooms } from '../shared/timeline';
import type { ZoomSegment } from '../shared/types';

const shot = (id: string, start: number, end: number, x: number, scale = 1.7): ZoomSegment => ({ id, start, end, x, y: .5, scale });
test('adjacent shots keep the magnification and move their focus continuously', () => {
  const shots = [shot('a', 1, 4, .3), shot('b', 4, 7, .7)];
  for (let time = 2; time <= 6; time += 1 / 30) assert.ok(Math.abs(cameraAt(shots, time).scale - 1.7) < 1e-8);
  assert.ok(Math.abs(cameraAt(shots, 3.999).x - cameraAt(shots, 4.001).x) < .005);
  assert.equal(cameraAt(shots, 1).scale, 1); assert.equal(cameraAt(shots, 7).scale, 1);
});
test('a short pause bridges shots, while a real pause returns to full view', () => {
  const short = [shot('a', 1, 4, .3), shot('b', 4.5, 7, .7)];
  assert.equal(cameraAt(short, 4.2).scale, 1.7);
  const long = [shot('a', 1, 4, .3), shot('b', 6, 9, .7)];
  assert.equal(cameraAt(long, 4).scale, 1); assert.equal(cameraAt(long, 5).scale, 1);
});
test('short linked shots and changed scales never produce a full-view flash', () => {
  const shots = [shot('a', 1, 1.5, .3), shot('b', 1.5, 2, .7, 2.2), shot('c', 2, 4, .4)];
  for (let time = 1.25; time <= 3; time += 1 / 60) assert.ok(cameraAt(shots, time).scale >= 1.7 - 1e-8);
  assert.equal(cameraAt([...shots].reverse(), 2.3).scale, cameraAt(shots, 2.3).scale);
});
test('generated consecutive distant clicks have continuous playback without changing editable segments', () => {
  const shots = generateAutoZooms([1, 2, 3, 4].map((t, i) => ({ t, x: i % 2 ? .8 : .2, y: .5,
    click: true, visible: true, shape: 'arrow' })), 8);
  assert.ok(shots.length >= 2);
  for (let t = 1.5; t <= 4.8; t += .02) assert.ok(cameraAt(shots, t).scale > 1.6);
});
