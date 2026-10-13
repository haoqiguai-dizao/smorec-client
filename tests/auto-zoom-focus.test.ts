import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAutoZooms, cameraAt } from '../shared/timeline';
import type { InputActivity } from '../shared/types';

const at = (t: number, x = 0.35, y = 0.4): InputActivity => ({ t, kind: 'typing', focus: { x, y } });

test('verified typing focus creates a shot without any click, including autofocus and Tab', () => {
  const zooms = generateAutoZooms([], 15, [at(1), at(2), { t: 3, kind: 'reset' }, at(3.2, 0.7, 0.65), at(5, 0.7, 0.65)]);
  assert.equal(zooms.length, 2);
  assert.equal(zooms[0].x, 0.35);
  assert.equal(zooms[1].x, 0.7);
  assert.equal(zooms[1].y, 0.65);
  assert.equal(cameraAt(zooms, 5).scale, 1.7);
  assert.equal(cameraAt(zooms, 8).scale, 1);
  assert.ok(zooms[0].end <= zooms[1].start);
});

test('focus location overrides an unrelated click and never follows a moved pointer', () => {
  const cursor = [{ t: 0.1, x: 0.1, y: 0.1, click: true, visible: true },
    { t: 2, x: 0.99, y: 0.99, visible: true }];
  const zooms = generateAutoZooms(cursor, 10, [at(1, 0.7, 0.6), at(2, 0.71, 0.6), at(3, 0.72, 0.6)]);
  const typing = zooms.find(zoom => zoom.id.startsWith('auto-focus'))!;
  assert.equal(typing.x, 0.7);
  assert.equal(typing.y, 0.6);
  assert.ok(typing.end > 5);
});

test('nearby caret drift holds a stable camera while a distant field starts a new shot', () => {
  const zooms = generateAutoZooms([], 10, [at(1), at(2, 0.4, 0.4), at(3, 0.6, 0.4), at(4, 0.61, 0.4)]);
  assert.equal(zooms.length, 2);
  assert.equal(zooms[0].x, 0.35);
  assert.equal(zooms[1].x, 0.6);
  assert.ok(zooms[0].end <= zooms[1].start);
});

test('long pauses retain full view between independent focused input bursts', () => {
  const zooms = generateAutoZooms([], 30, [at(1), at(2), at(20), at(21)]);
  assert.equal(zooms.length, 2);
  assert.equal(cameraAt(zooms, 10).scale, 1);
  assert.equal(cameraAt(zooms, 21).scale, 1.7);
  assert.equal(zooms[1].x, 0.35);
});

test('invalid focus coordinates cannot invent a new shot or alter reset meaning', () => {
  for (const focus of [null, {}, { x: -0.1, y: 0.4 }, { x: NaN, y: 0.4 }, { x: 0.5, y: Infinity }]) {
    assert.deepEqual(generateAutoZooms([], 10, [{ t: 1, kind: 'typing', focus }] as InputActivity[]), []);
  }
  assert.deepEqual(generateAutoZooms([], 10, [{ t: 1, kind: 'reset', focus: { x: 0.5, y: 0.5 } }]), []);
});

test('focused events remain deterministic and do not mutate captured metadata', () => {
  const events = [at(1), at(2), at(3, 0.8, 0.8), at(5, 0.8, 0.8)];
  events.forEach(event => { Object.freeze(event.focus); Object.freeze(event); });
  const first = generateAutoZooms([], 12, events);
  assert.deepEqual(generateAutoZooms([], 12, [...events, ...events].reverse()), first);
  assert.equal(new Set(first.map(zoom => zoom.id)).size, first.length);
});

test('click grouping cannot let a future click delay an intervening focused typing shot', () => {
  const cursor = [1, 2].map(t => ({ t, x: 0.1, y: 0.1, visible: true, click: true }));
  const zooms = generateAutoZooms(cursor, 6, [at(1.2, 0.8, 0.8)]);
  const focusShot = zooms.find(zoom => zoom.x === 0.8)!;
  assert.ok(focusShot.start <= 1.2 && focusShot.end > 1.2);
  assert.equal(zooms.length, 3);
  for (let index = 1; index < zooms.length; index++) assert.ok(zooms[index - 1].end <= zooms[index].start);
});
