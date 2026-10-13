import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveZoom } from '../shared/live-zoom';
import type { LiveInput } from '../shared/live-types';

const click = (t: number, x = .35, y = .4, visible = true): LiveInput => ({ cursor: { t, x, y, visible, click: true } });
const typing = (t: number, x?: number, y = .4): LiveInput => ({ activity: { t, kind: 'typing',
  ...(x === undefined ? {} : { focus: { x, y } }) } });
const reset = (t: number): LiveInput => ({ activity: { t, kind: 'reset' } });
const near = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-3, `${a} != ${b}`);

function settle(zoom: LiveZoom, from: number, to: number): void {
  for (let time = from; time < to; time += 1 / 30) zoom.at(time);
}

test('batch order is timestamp then reset, click and typing, even with combined transport items', () => {
  const first = new LiveZoom(), second = new LiveZoom();
  first.ingest([typing(1), click(1), reset(1)]);
  second.ingest([{ ...reset(1), ...click(1) }, typing(1)]);
  near(first.at(1.5).scale, second.at(1.5).scale);
  // Typing holds two seconds instead of the shorter click hold.
  near(first.at(2.9).scale, 1.7);
});

test('a delayed click reset cannot erase the same-time click or newer typing in another batch', () => {
  const zoom = new LiveZoom();
  zoom.ingest([click(1), typing(1.1)]); zoom.at(1.2);
  zoom.ingest([reset(1)]);
  near(zoom.at(2.9).scale, 1.7);
  const sameTime = new LiveZoom();
  sameTime.ingest([click(1)]); sameTime.at(1.1); sameTime.ingest([reset(1)]);
  assert.ok(sameTime.at(1.4).scale > 1.6);
});

test('a genuinely newer reset clears the anchor and unlocated typing cannot restore it', () => {
  const zoom = new LiveZoom(); zoom.ingest([click(1), typing(1.1)]); zoom.at(1.6);
  zoom.ingest([reset(1.7), typing(1.8)]);
  assert.equal(zoom.at(3).scale, 1);
});

test('autofocus typing creates a camera without a click and Tab can retarget another field', () => {
  const zoom = new LiveZoom(); zoom.ingest([typing(1, .35)]);
  assert.ok(zoom.at(1.5).scale > 1.68);
  zoom.ingest([reset(1.6), typing(1.7, .75, .7)]);
  const next = zoom.at(2.5);
  near(next.scale, 1.7);
  assert.ok(next.x > .65 && next.y > .65);
});

test('future input never changes an earlier rendered frame', () => {
  const zoom = new LiveZoom(); zoom.ingest([typing(10, .35)]);
  assert.deepEqual(zoom.at(5), { x: .5, y: .5, scale: 1 });
  assert.deepEqual(zoom.at(10), { x: .5, y: .5, scale: 1 });
  assert.ok(zoom.at(10.5).scale > 1.68);
});

test('pointer-only samples do not establish focus or invalidate a delayed valid typing sample', () => {
  const zoom = new LiveZoom();
  zoom.ingest([{ cursor: { t: 100, x: .9, y: .9, visible: true } }]);
  zoom.at(1); zoom.ingest([typing(1, .35)]);
  assert.ok(zoom.at(1.5).scale > 1.68);
});

test('disable and reenable require fresh located input and do not replay disabled activity', () => {
  const zoom = new LiveZoom(); zoom.ingest([typing(1, .35)]); zoom.at(1.5);
  zoom.toggle(); zoom.ingest([click(2), typing(2.1, .75)]);
  assert.equal(zoom.at(3).scale, 1);
  zoom.toggle(); zoom.ingest([reset(2), click(2.1), typing(3.1)]);
  assert.equal(zoom.at(3.5).scale, 1);
  zoom.ingest([typing(4, .75)]);
  assert.ok(zoom.at(4.5).scale > 1.68);
});

test('manual full view rejects transport backlog and waits for a new target', () => {
  const zoom = new LiveZoom(); zoom.ingest([typing(1, .35)]); zoom.at(1.5);
  zoom.reset(); zoom.ingest([typing(1.4, .35)]);
  assert.equal(zoom.at(3).scale, 1);
});

test('a static source still expires by source-clock time, including long gaps between frames', () => {
  const zoom = new LiveZoom(); zoom.ingest([typing(1, .35)]); zoom.at(1.5);
  assert.equal(zoom.at(10).scale, 1);
  const frequent = new LiveZoom(), sparse = new LiveZoom();
  frequent.ingest([typing(1, .35)]); sparse.ingest([typing(1, .35)]);
  settle(frequent, 0, 4); frequent.at(4);
  const final = sparse.at(4);
  near(final.scale, frequent.at(4).scale);
  near(final.x, frequent.at(4).x);
});

test('backward or invalid timestamps cannot rewind or corrupt the camera', () => {
  const zoom = new LiveZoom(); zoom.ingest([typing(1, .35)]);
  const current = zoom.at(1.5);
  assert.deepEqual(zoom.at(1.2), current); assert.deepEqual(zoom.at(NaN), current);
  zoom.ingest([click(NaN), click(-1), typing(Infinity, .75)]);
  assert.equal(zoom.at(10).scale, 1);
});

test('invalid and invisible clicks clear focus while invalid typing coordinates cannot invent it', () => {
  for (const event of [typing(1, NaN), typing(1, -1), typing(1, .5, Infinity), typing(1)]) {
    const zoom = new LiveZoom(); zoom.ingest([event]); assert.equal(zoom.at(2).scale, 1);
  }
  const zoom = new LiveZoom(); zoom.ingest([click(1), click(1.1, .5, .5, false), typing(1.2)]);
  assert.equal(zoom.at(3).scale, 1);
});

test('camera coordinates always stay within the scaled canvas', () => {
  const zoom = new LiveZoom();
  zoom.ingest([typing(1, 0, 0), typing(2, 1, 1), typing(3, 0, 1), reset(4)]);
  for (let time = 0; time <= 6; time += 1 / 60) {
    const frame = zoom.at(time), margin = .5 / frame.scale;
    assert.ok(frame.scale >= 1 && frame.scale <= 1.7);
    assert.ok(frame.x >= margin && frame.x <= 1 - margin && frame.y >= margin && frame.y <= 1 - margin);
  }
});
