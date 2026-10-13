import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { cameraAt, generateAutoZooms, outputToSourceTime } from '../shared/timeline';
import type { CursorSample, InputActivity, ZoomSegment } from '../shared/types';

const click = (t: number, x = 0.3, y = 0.4, visible = true): CursorSample => ({ t, x, y, visible, click: true });
const typing = (...times: number[]): InputActivity[] => times.map((t) => ({ t, kind: 'typing' }));
const reset = (t: number): InputActivity => ({ t, kind: 'reset' });
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

function assertValidPlan(zooms: ZoomSegment[], duration: number) {
  assert.equal(new Set(zooms.map((zoom) => zoom.id)).size, zooms.length);
  for (const [index, zoom] of zooms.entries()) {
    assert.ok(zoom.start >= 0 && zoom.end <= duration && zoom.end - zoom.start > 0.1);
    assert.ok(Number.isFinite(zoom.x) && Number.isFinite(zoom.y));
    if (index) assert.ok(zooms[index - 1].end <= zoom.start);
  }
}

test('native late-click focus-race fixture retains the newly clicked typing focus', () => {
  const fixture: { duration: number; cursor: CursorSample[]; inputActivity: InputActivity[] }
    = JSON.parse(readFileSync(new URL('./fixtures/typing-focus-click-race.json', import.meta.url), 'utf8'));
  const zooms = generateAutoZooms(fixture.cursor, fixture.duration, fixture.inputActivity);
  const target = fixture.cursor.find((sample) => sample.click && sample.t === 1)!;
  for (const time of [2, 4.8]) {
    const active = zooms.find((zoom) => time >= zoom.start && time < zoom.end)!;
    assert.equal(active.x, target.x); assert.equal(active.y, target.y);
    near(cameraAt(zooms, time).scale, 1.7);
  }
  near(cameraAt(zooms, 5.6).scale, 1);
  assertValidPlan(zooms, fixture.duration);
});

test('click-only projects retain exact grouping, IDs, coordinates and timing', () => {
  const cursor = [click(0.1), click(0.2, 0.32, 0.42), click(0.7, 0.9, 0.9), click(1.6, 0.5, 0.5, false)];
  const expected = [
    { id: 'auto-0-100', start: 0, end: (0.2 + 0.7) / 2, x: 0.31, y: 0.41000000000000003, scale: 1.7 },
    { id: 'auto-1-700', start: (0.2 + 0.7) / 2, end: 2, x: 0.9, y: 0.9, scale: 1.7 },
  ];
  assert.deepEqual(generateAutoZooms(cursor, 2), expected);
  assert.deepEqual(generateAutoZooms(cursor, 2, []), expected);
  assert.deepEqual(generateAutoZooms(cursor, 2, [reset(0.05), reset(1)]), expected);
  assert.deepEqual(generateAutoZooms(cursor, 2, typing(0.01)), expected);
});

test('sustained typing keeps the clicked focus while the pointer moves away', () => {
  const cursor = [click(1), { t: 2, x: 0.99, y: 0.99, visible: true }];
  const events = typing(...Array.from({ length: 39 }, (_, index) => 1.5 + index * 0.5));
  const zooms = generateAutoZooms(cursor, 30, events);
  assert.equal(zooms.length, 1);
  assert.equal(zooms[0].x, 0.3);
  assert.equal(zooms[0].y, 0.4);
  near(zooms[0].end, 22.95);
  for (let t = 1; t <= 22.5; t += 0.05) near(cameraAt(zooms, t).scale, 1.7);
  assert.ok(cameraAt(zooms, 22.6).scale < 1.7);
  near(cameraAt(zooms, 22.95).scale, 1);
});

test('the two second idle hold excludes the additional exit animation', () => {
  const zooms = generateAutoZooms([click(1)], 10, typing(1.1, 2));
  near(zooms[0].end, 4.45);
  near(cameraAt(zooms, 4).scale, 1.7);
  assert.ok(cameraAt(zooms, 4.1).scale < 1.7);
  assert.ok(cameraAt(zooms, 4.1).scale > 1);
  near(cameraAt(zooms, 4.45).scale, 1);
});

test('short pauses do not create a zoom-out valley during typing', () => {
  const zooms = generateAutoZooms([click(1)], 15, typing(1.2, 2, 3.9, 5.8, 7.7));
  assert.equal(zooms.length, 1);
  for (let frame = 60; frame <= 582; frame++) near(cameraAt(zooms, frame / 60).scale, 1.7);
});

test('typing after a long initial pause creates a separate shot at the click', () => {
  const cursor = [click(1), { t: 15, x: 0.95, y: 0.1, visible: true }];
  const zooms = generateAutoZooms(cursor, 40, typing(20, 21));
  assert.equal(zooms.length, 2);
  near(zooms[0].end, 2.65);
  near(zooms[1].start, 19.55);
  near(zooms[1].end, 23.45);
  assert.equal(zooms[1].x, 0.3);
  assert.equal(zooms[1].y, 0.4);
  near(cameraAt(zooms, 10).scale, 1);
  near(cameraAt(zooms, 20).scale, 1.7);
  assertValidPlan(zooms, 40);
});

test('a long mid-input pause is not bridged into a long static zoom', () => {
  const zooms = generateAutoZooms([click(1)], 50, typing(1.5, 2, 30, 31));
  assert.equal(zooms.length, 2);
  near(zooms[0].end, 4.45);
  near(zooms[1].start, 29.55);
  for (let t = 5; t < 29; t++) near(cameraAt(zooms, t).scale, 1);
  assert.equal(zooms[1].id, 'auto-0-1000-typing-30000');
});

test('focus reset stops the extension and discards later unanchored typing', () => {
  const zooms = generateAutoZooms([click(1)], 40, [...typing(1.2, 2), reset(2.1), ...typing(3, 10, 30)]);
  assert.equal(zooms.length, 1);
  near(zooms[0].end, 2.65);
  near(cameraAt(zooms, 3).scale, 1);
  near(cameraAt(zooms, 30).scale, 1);
});

test('reset terminates a resumed typing shot without extending its original click', () => {
  const zooms = generateAutoZooms([click(1)], 40, [...typing(20, 21), reset(21.1), ...typing(22, 30)]);
  assert.equal(zooms.length, 2);
  near(zooms[0].end, 2.65);
  near(zooms[1].end, 21.55);
  near(cameraAt(zooms, 23).scale, 1);
});

test('an invisible click invalidates an earlier typing anchor', () => {
  const zooms = generateAutoZooms([click(1), click(4, 0.8, 0.8, false)], 20, typing(1.5, 3, 4.1, 10));
  assert.equal(zooms.length, 1);
  near(zooms[0].end, 4.45);
  near(cameraAt(zooms, 10).scale, 1);
});

test('typing without a valid visible click cannot use the current pointer as a focus', () => {
  for (const cursor of [[], [click(1, 0.3, 0.4, false)], [{ t: 1, x: 0.3, y: 0.4, visible: true }]]) {
    assert.deepEqual(generateAutoZooms(cursor, 20, typing(2, 3, 4, 10)), []);
  }
});

test('same-time events reset first, then click, then typing regardless of array order', () => {
  const activity = [reset(1), ...typing(1)];
  const zooms = generateAutoZooms([click(1)], 10, activity);
  near(zooms[0].end, 3.45);
  assert.deepEqual(generateAutoZooms([click(1)], 10, [...activity].reverse()), zooms);
});

test('a new distant click gets its own bounded focus after reset', () => {
  const cursor = [click(1, 0.15, 0.2), click(4, 0.85, 0.8)];
  const zooms = generateAutoZooms(cursor, 12, [...typing(1.2, 2, 3.8), reset(4), ...typing(4.1, 5)]);
  assert.equal(zooms.length, 2);
  assert.equal(zooms[0].x, 0.15);
  assert.equal(zooms[1].x, 0.85);
  near(zooms[1].end, 7.45);
  assertValidPlan(zooms, 12);
  for (let frame = 0; frame <= 720; frame++) {
    const camera = cameraAt(zooms, frame / 60);
    const margin = 0.5 / camera.scale;
    assert.ok(camera.x >= margin && camera.x <= 1 - margin);
    assert.ok(camera.y >= margin && camera.y <= 1 - margin);
  }
});

test('nearby clicks during sustained typing do not introduce a full-view dip', () => {
  const cursor = [click(1), click(5, 0.32, 0.42)];
  const zooms = generateAutoZooms(cursor, 12, [...typing(1.5, 2.5, 3.5, 4.5), reset(5), ...typing(5.1, 5.5)]);
  assert.equal(zooms.length, 1);
  assert.equal(zooms[0].x, 0.3);
  for (let frame = 60; frame <= 450; frame++) near(cameraAt(zooms, frame / 60).scale, 1.7);
});

test('an independent focus reset does not merge two nearby click groups', () => {
  const cursor = [click(1), click(5, 0.32, 0.42)];
  const zooms = generateAutoZooms(cursor, 12, [...typing(1.5, 2.5, 3.5, 4.5), reset(4.8), reset(5), ...typing(5.1)]);
  assert.equal(zooms.length, 2);
  assertValidPlan(zooms, 12);
});

test('nearby clicks after a fully expired typing hold retain a new shot', () => {
  const zooms = generateAutoZooms([click(1), click(10)], 20, [...typing(1.5, 2), reset(10), ...typing(10.1)]);
  assert.equal(zooms.length, 2);
  near(cameraAt(zooms, 7).scale, 1);
});

test('recording boundaries clamp input holds and never create an empty segment', () => {
  const zooms = generateAutoZooms([click(0), click(9.95, 0.9, 0.9)], 10, typing(0, 0.1, 9.99, 10));
  assertValidPlan(zooms, 10);
  assert.equal(zooms[0].start, 0);
  assert.equal(zooms.at(-1)?.end, 10);
  near(cameraAt(zooms, 10).scale, 1);
  assert.deepEqual(generateAutoZooms([click(0)], 0, typing(0)), []);
});

test('invalid activity values do not change a legacy click-only project', () => {
  const invalid = [null, undefined, {}, { t: NaN, kind: 'typing' }, { t: Infinity, kind: 'typing' },
    { t: -1, kind: 'typing' }, { t: 5, kind: 'typing' }, { t: 1, kind: 'unknown' },
    { t: '1', kind: 'typing' }] as unknown as InputActivity[];
  const baseline = generateAutoZooms([click(1)], 5);
  assert.deepEqual(generateAutoZooms([click(1)], 5, invalid), baseline);
  assert.deepEqual(generateAutoZooms([click(1)], 5, {} as InputActivity[]), baseline);
  assert.deepEqual(generateAutoZooms([click(1)], 5, [...invalid, ...typing(2)]),
    generateAutoZooms([click(1)], 5, typing(2)));
});

test('invalid click coordinates cannot become a typing anchor', () => {
  for (const invalid of [click(1, NaN), click(1, Infinity), click(1, -0.1), click(1, 1.1)]) {
    assert.deepEqual(generateAutoZooms([invalid], 10, typing(2)), []);
  }
});

test('event ordering, duplicates and irrelevant pointer samples do not alter stable IDs', () => {
  const cursor = [click(1), { t: 19, x: 0.8, y: 0.8, visible: true }];
  const activity = typing(1.5, 2, 20, 21);
  const zooms = generateAutoZooms(cursor, 40, activity);
  assert.deepEqual(generateAutoZooms(cursor, 40, [...activity, ...activity].reverse()), zooms);
  assert.deepEqual(generateAutoZooms([click(1)], 40, activity), zooms);
  assertValidPlan(zooms, 40);
});

test('generation never mutates the source journal or existing editable camera plan', () => {
  const cursor = [click(1)];
  const activity = typing(1.5, 2, 20);
  cursor.forEach(Object.freeze);
  activity.forEach(Object.freeze);
  Object.freeze(cursor);
  Object.freeze(activity);
  const original = generateAutoZooms(cursor, 30, activity);
  const snapshot = structuredClone(original);
  const regenerated = generateAutoZooms(cursor, 30, activity);
  regenerated[0].x = 0.7;
  assert.deepEqual(original, snapshot);
});

test('trimmed preview and export resolve a typing hold on the same source clock', () => {
  const zooms = generateAutoZooms([click(1)], 30, typing(1.5, 2, 20, 21));
  const clips = [{ id: 'first', start: 1, end: 3 }, { id: 'typing', start: 20, end: 24 }];
  const source = outputToSourceTime(clips, 2);
  assert.equal(source, 20);
  near(cameraAt(zooms, source).scale, 1.7);
  near(cameraAt(zooms, outputToSourceTime(clips, 5)).scale, 1.7);
  near(cameraAt(zooms, outputToSourceTime(clips, 6)).scale, 1);
});

test('dense mixed focus activity stays deterministic, finite and nonoverlapping', () => {
  const cursor = Array.from({ length: 60 }, (_, index) => click(index + 0.1, index % 3 / 3, index % 4 / 4));
  const activity = cursor.flatMap((sample) => [reset(sample.t), ...typing(sample.t + 0.1, sample.t + 0.2, sample.t + 0.7)]);
  const zooms = generateAutoZooms(cursor, 61, activity);
  assertValidPlan(zooms, 61);
  assert.deepEqual(generateAutoZooms(cursor, 61, activity), zooms);
});
