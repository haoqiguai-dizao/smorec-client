import assert from 'node:assert/strict';
import test from 'node:test';
import { selectionActivities } from '../shared/auto-zoom/text-selection';
import { generateAutoZooms, cameraAt } from '../shared/timeline';
import { LiveZoom } from '../shared/live-zoom';
import type { CursorSample } from '../shared/types';
import { parseProject } from '../electron/services/validation';
import { DEFAULT_STYLE } from '../shared/constants';

function drag(start = 1, end = 5, from = .3, to = .5): CursorSample[] {
  const samples: CursorSample[] = [];
  for (let t = start; t < end; t += .05) samples.push({ t, x: from + (to - from) * (t - start) / (end - start),
    y: .4, visible: true, shape: 'ibeam', primaryDown: true });
  samples.push({ t: end, x: to, y: .4, visible: true, shape: 'ibeam', primaryDown: false });
  return samples;
}

test('text drag stays magnified beyond click expiry and holds after release', () => {
  const cursor = [{ t: 1, x: .3, y: .4, visible: true, click: true }, ...drag()];
  const zooms = generateAutoZooms(cursor, 10);
  assert.ok(cameraAt(zooms, 4.5).scale > 1.6);
  assert.ok(cameraAt(zooms, 6.5).scale > 1.6);
  assert.equal(cameraAt(zooms, 8).scale, 1);
  assert.ok(Math.abs(cameraAt(zooms, 4.5).x - .4) < .01);
  assert.ok(zooms.every((zoom, i) => !i || zoom.start >= zooms[i - 1].end));
});

test('holding still after a confirmed selection continues the same shot', () => {
  const samples = drag(1, 2);
  samples.at(-1)!.primaryDown = true;
  for (let t = 2.05; t < 9; t += .05) samples.push({ ...samples.at(-1)!, t });
  assert.equal(generateAutoZooms(samples, 12).length, 1);
  assert.ok(cameraAt(generateAutoZooms(samples, 12), 8).scale > 1.6);
});

test('hover, stationary presses, short jitter and ordinary object drags add no selection shot', () => {
  for (const samples of [drag().map(s => ({ ...s, primaryDown: false })), drag(1, 5, .3, .3),
    drag(1, 5, .3, .301), drag(1, 1.1), drag().map(s => ({ ...s, shape: 'arrow' as const }))]) {
    assert.deepEqual(selectionActivities(samples, 10), []);
    assert.deepEqual(generateAutoZooms(samples, 10), []);
  }
});

test('legacy recordings keep exact click behavior without invented selections', () => {
  const old = drag().map(({ t, x, y, visible, shape }) => ({ t, x, y, visible, shape }));
  const click = { t: 1, x: .3, y: .4, visible: true, click: true };
  assert.deepEqual(generateAutoZooms([click, ...old], 10), generateAutoZooms([click], 10));
});

test('wide reverse selection fits its full observed bounds with context', () => {
  const zooms = generateAutoZooms(drag(1, 5, .92, .08), 10);
  const shot = zooms[0];
  assert.ok(shot.scale < 1.1);
  assert.ok(Math.abs(shot.x - .5) < .01);
  assert.ok(shot.x - .5 / shot.scale < .09);
  assert.ok(shot.x + .5 / shot.scale > .91);
});

test('leaving capture, shape changes and sample gaps cannot prolong selection indefinitely', () => {
  for (const changed of [{ visible: false }, { shape: 'arrow' as const }, { x: NaN }, { primaryDown: undefined }]) {
    const samples = drag().map(s => s.t >= 2 ? { ...s, ...changed } : s);
    assert.ok(selectionActivities(samples, 10).every(e => e.t < 2));
    assert.equal(cameraAt(generateAutoZooms(samples, 10), 5).scale, 1);
  }
  const gap = drag().filter(s => s.t < 2 || s.t > 3);
  assert.ok(selectionActivities(gap, 10).every(e => e.t < 2));
});

test('new press is required after entering text from a nontext drag', () => {
  const samples = drag().map(s => s.t < 2 ? { ...s, shape: 'arrow' as const } : s);
  assert.deepEqual(selectionActivities(samples, 10), []);
});

test('click packets cannot supply false primary state or interrupt a held selection', () => {
  const samples = drag();
  samples.push({ t: 3, x: .2, y: .2, visible: true, click: true, shape: 'arrow' });
  assert.deepEqual(selectionActivities(samples, 10), selectionActivities(drag(), 10));
});

test('selection hands off to nearby typing without dropping magnification', () => {
  const zooms = generateAutoZooms(drag(), 12, [{ t: 5.2, kind: 'typing', focus: { x: .4, y: .4 } },
    { t: 6, kind: 'typing' }, { t: 7, kind: 'typing' }]);
  assert.equal(zooms.length, 1);
  assert.ok(cameraAt(zooms, 8.5).scale > 1.6);
});

test('a new wide selection cannot inherit a nearby narrow typing or selection frame', () => {
  for (const earlier of [drag(1, 2, .3, .4), []]) {
    const cursor = [...earlier, ...drag(2.1, 5, .05, .8)];
    const zooms = generateAutoZooms(cursor, 10, [{ t: 1, kind: 'typing', focus: { x: .35, y: .4 } }]);
    const camera = cameraAt(zooms, 4.5);
    assert.ok(camera.scale < 1.15);
    assert.ok(camera.x - .5 / camera.scale <= .06);
    assert.ok(camera.x + .5 / camera.scale >= .79);
  }
});

test('live camera consumes selection on source time and preserves post-release hold', () => {
  const zoom = new LiveZoom();
  zoom.ingest(drag().map(cursor => ({ cursor })));
  assert.equal(zoom.at(.8).scale, 1);
  assert.ok(zoom.at(4).scale > 1.6);
  assert.ok(zoom.at(6.5).scale > 1.6);
  assert.equal(zoom.at(9).scale, 1);
});

test('copy-style resets preserve the short reading hold without retaining a typing anchor', () => {
  const activity = [{ t: 5.1, kind: 'reset' as const }, { t: 5.3, kind: 'typing' as const }];
  const zooms = generateAutoZooms(drag(), 10, activity);
  assert.ok(cameraAt(zooms, 6.5).scale > 1.6);
  assert.equal(cameraAt(zooms, 8).scale, 1);
  const live = new LiveZoom();
  live.ingest([...drag().map(cursor => ({ cursor })), ...activity.map(activity => ({ activity }))]);
  assert.ok(live.at(6.5).scale > 1.6);
  assert.equal(live.at(9).scale, 1);
});

test('sampled primary-up positions do not discard delayed typing from another native batch', () => {
  const live = new LiveZoom();
  live.ingest([{ cursor: { t: 1.1, x: .5, y: .5, visible: true, primaryDown: false } }]);
  live.at(1.1);
  live.ingest([{ activity: { t: 1, kind: 'typing', focus: { x: .4, y: .4 } } }]);
  assert.ok(live.at(1.6).scale > 1.6);
});

test('live selection follows the observed bounds and fits long drags', () => {
  const zoom = new LiveZoom();
  zoom.ingest(drag(1, 5, .08, .92).map(cursor => ({ cursor })));
  assert.ok(zoom.at(2).scale > 1.6);
  assert.ok(zoom.at(5.5).scale < 1.1);
});

test('manual full-view and disabled live zoom do not replay buffered drag input', () => {
  const zoom = new LiveZoom();
  zoom.ingest(drag().map(cursor => ({ cursor })));
  assert.ok(zoom.at(3).scale > 1.6);
  zoom.reset();
  assert.equal(zoom.at(6).scale, 1);
  zoom.enabled = false;
  zoom.ingest(drag(7, 9).map(cursor => ({ cursor })));
  zoom.enabled = true;
  assert.equal(zoom.at(10).scale, 1);
});

test('selection metadata survives project validation and rejects nonboolean values', () => {
  const project = { id: '12345678-1234-1234-1234-123456789abc', name: 'Selection fixture',
    createdAt: '2026-09-14T00:00:00Z', duration: 10, width: 1280, height: 720, fps: 30,
    media: { screen: 'screen.mp4' }, cursor: drag(), clips: [{ id: 'clip', start: 0, end: 10 }],
    zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
  assert.deepEqual(parseProject(project).cursor, project.cursor);
  for (const primaryDown of [1, 'true', null]) {
    assert.throws(() => parseProject({ ...project, cursor: [{ ...drag()[0], primaryDown }] }));
  }
});

test('selection derivation is deterministic and does not mutate captured data', () => {
  const cursor = drag();
  cursor.forEach(Object.freeze); Object.freeze(cursor);
  assert.deepEqual(generateAutoZooms(cursor, 10), generateAutoZooms([...cursor].reverse(), 10));
});
