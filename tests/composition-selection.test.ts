import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLE } from '../shared/constants';
import { createCompositionSegment } from '../shared/composition';
import { selectCompositionAtSource } from '../shared/composition-selection';
import type { CompositionSegment, Project } from '../shared/types';

function project(): Project {
  return { id: 'project', name: 'Direct composition fixture', createdAt: '2026-09-08', duration: 12,
    width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.mp4' },
    camera: { offset: 0, enabled: true, position: 'bottom-right', size: 0.22, mirror: false, shape: 'circle', shrinkOnZoom: true },
    clips: [{ id: 'whole', start: 0, end: 12 }], cursor: [], zooms: [], style: { ...DEFAULT_STYLE },
    audio: { system: 1, microphone: 1 } };
}
const local = (id: string, start: number, end: number): CompositionSegment => ({ id, start, end, screen: 'recording',
  camera: { x: 0.1, y: 0.2, size: 0.5, visible: true } });
const bounds = (selection: ReturnType<typeof selectCompositionAtSource>) => selection && [selection.segment.start, selection.segment.end];
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('direct selection creates at most three local seconds without mutating source or camera tracks', () => {
  const input = project(), snapshot = structuredClone(input);
  const result = selectCompositionAtSource(input, 2, { id: 'direct-edit' })!;
  assert.equal(result.existing, false);
  assert.equal(result.segment.id, 'direct-edit');
  assert.deepEqual(bounds(result), [2, 5]);
  assert.equal(result.sourceTime, 2); assert.equal(result.outputTime, 2); assert.equal(result.clipIndex, 0);
  assert.deepEqual(result.segment.camera, createCompositionSegment(input, 2, 5).camera);
  assert.deepEqual(input, snapshot);
});

test('an existing interval wins and adjacent half-open boundaries belong to the later interval', () => {
  const input = project(); input.compositions = [local('first', 1, 3), local('second', 3, 7)];
  for (const [time, index] of [[1, 0], [2.99, 0], [3, 1], [6.99, 1]]) {
    const result = selectCompositionAtSource(input, time, { id: 'unused' })!;
    assert.equal(result.existing, true); assert.equal(result.segment, input.compositions[index]);
  }
  assert.deepEqual(bounds(selectCompositionAtSource(input, 7)), [7, 10]);
});

test('short forward room expands backward only inside the empty neighboring interval', () => {
  const input = project(); input.compositions = [local('before', 0, 3), local('after', 6, 10)];
  assert.deepEqual(bounds(selectCompositionAtSource(input, 5.5)), [3, 6]);
  input.compositions[0].end = 4.5;
  assert.deepEqual(bounds(selectCompositionAtSource(input, 5.5)), [4.5, 6]);
  assert.deepEqual(input.compositions.map(item => [item.start, item.end]), [[0, 4.5], [6, 10]]);
});

test('source gaps and trimmed head/tail are never used as an automatic range', () => {
  const input = project(); input.clips = [{ id: 'first', start: 1, end: 3 }, { id: 'second', start: 7, end: 11 }];
  assert.deepEqual(bounds(selectCompositionAtSource(input, 2.8)), [1, 3]);
  const second = selectCompositionAtSource(input, 7, { outputTime: 2 })!;
  assert.deepEqual(bounds(second), [7, 10]); assert.equal(second.outputTime, 2); assert.equal(second.clipIndex, 1);
  assert.equal(selectCompositionAtSource(input, 0.5), undefined);
  assert.equal(selectCompositionAtSource(input, 5), undefined);
  assert.equal(selectCompositionAtSource(input, 11.5), undefined);
});

test('a stale output hint cannot redirect the displayed source into another clip', () => {
  const input = project(); input.clips = [{ id: 'first', start: 0, end: 2 }, { id: 'second', start: 5, end: 9 }];
  const result = selectCompositionAtSource(input, 1.5, { outputTime: 3, clipIndex: 1 })!;
  assert.equal(result.clipIndex, 0); assert.equal(result.sourceTime, 1.5); assert.equal(result.outputTime, 1.5);
  assert.deepEqual(bounds(result), [0, 2]);
});

test('the final exclusive boundary seeks a stable last frame and creates a bounded tail edit', () => {
  const input = project(); input.clips = [{ id: 'first', start: 1, end: 3 }, { id: 'last', start: 7, end: 11 }];
  const result = selectCompositionAtSource(input, 11, { outputTime: 6 })!;
  close(result.sourceTime, 11 - 1 / 30); close(result.outputTime, 6 - 1 / 30);
  assert.equal(result.clipIndex, 1); assert.deepEqual(bounds(result), [8, 11]);
  assert.ok(result.sourceTime >= result.segment.start && result.sourceTime < result.segment.end);
});

test('contiguous cut boundaries use the later clip unless the displayed-frame hint identifies the earlier one', () => {
  const input = project(); input.clips = [{ id: 'first', start: 0, end: 4 }, { id: 'second', start: 4, end: 8 }];
  const next = selectCompositionAtSource(input, 4)!;
  assert.equal(next.clipIndex, 1); assert.equal(next.sourceTime, 4); assert.deepEqual(bounds(next), [4, 7]);
  const prior = selectCompositionAtSource(input, 4, { clipIndex: 0 })!;
  assert.equal(prior.clipIndex, 0); close(prior.sourceTime, 4 - 1 / 30); assert.deepEqual(bounds(prior), [1, 4]);
});

test('output positions use the selected occurrence rather than a first-match reverse source mapping', () => {
  const input = project(); input.clips = [{ id: 'later', start: 7, end: 10 }, { id: 'early', start: 1, end: 4 }];
  assert.equal(selectCompositionAtSource(input, 2)!.outputTime, 4);
  input.clips = [{ id: 'first', start: 2, end: 6 }, { id: 'repeated', start: 2, end: 6 }];
  const selected = selectCompositionAtSource(input, 3, { outputTime: 5 })!;
  assert.equal(selected.clipIndex, 1); assert.equal(selected.outputTime, 5);
});

test('backward tail expansion freezes the clicked camera, not the older range-start layout', () => {
  const input = project();
  input.camera!.keyframes = [
    { t: 0, x: 0.2, y: 0.2, size: 0.2, visible: true, shape: 'circle', mirror: false },
    { t: 10, x: 0.8, y: 0.7, size: 0.4, visible: true, shape: 'rounded', mirror: true },
  ];
  const result = selectCompositionAtSource(input, 11)!;
  assert.deepEqual(bounds(result), [9, 12]);
  assert.deepEqual(result.segment.camera, createCompositionSegment(input, 11, 12).camera);
  assert.notDeepEqual(result.segment.camera, createCompositionSegment(input, 9, 12).camera);
});

test('backward tail expansion preserves desktop privacy over an earlier presenter interval', () => {
  const input = project(); input.camera!.modeKeyframes = [{ t: 0, mode: 'overlay' }, { t: 9, mode: 'presenter' }, { t: 10, mode: 'overlay' }];
  const result = selectCompositionAtSource(input, 11)!;
  assert.deepEqual(bounds(result), [9, 12]); assert.equal(result.segment.screen, 'hidden');
  input.compositions = [{ ...local('selected', 10, 12), screen: 'background', background: 'mint', camera: { visible: false } }];
  const existing = selectCompositionAtSource(input, 11)!;
  assert.equal(existing.segment, input.compositions[0]); assert.equal(existing.segment.camera!.visible, false);
});

test('one-frame empty intervals work while sub-frame gaps are refused without neighboring changes', () => {
  const input = project(), frame = 1 / input.fps;
  input.compositions = [local('before', 0, 5), local('after', 5 + frame, 12)];
  const exact = selectCompositionAtSource(input, 5 + frame / 2)!;
  assert.deepEqual(bounds(exact), [5, 5 + frame]);
  input.compositions[1].start = 5 + frame / 2;
  assert.equal(selectCompositionAtSource(input, 5 + frame / 4), undefined);
  assert.equal(input.compositions[0].end, 5); assert.equal(input.compositions[1].start, 5 + frame / 2);
});

test('an exact one-frame trimmed clip remains editable at its final displayed frame', () => {
  const input = project(), frame = 1 / input.fps;
  input.clips = [{ id: 'one-frame', start: 8, end: 8 + frame }];
  const result = selectCompositionAtSource(input, 8 + frame, { outputTime: frame })!;
  close(result.sourceTime, 8); close(result.outputTime, 0);
  assert.deepEqual(bounds(result), [8, 8 + frame]);
});

test('malformed timestamps, hints and duplicate new ids cannot create an invalid selection', () => {
  const input = project();
  for (const value of [NaN, Infinity, -1, 13]) assert.equal(selectCompositionAtSource(input, value), undefined);
  for (const options of [{ clipIndex: -1 }, { clipIndex: 0.5 }, { clipIndex: 99 }, { outputTime: NaN },
    { outputTime: -1 }, { outputTime: 13 }, { id: ' ' }, { id: 'x'.repeat(201) }]) {
    assert.equal(selectCompositionAtSource(input, 2, options), undefined);
  }
  input.compositions = [local('taken', 8, 10)];
  assert.equal(selectCompositionAtSource(input, 2, { id: 'taken' }), undefined);
  assert.equal(selectCompositionAtSource({ ...input, fps: 0 } as unknown as Project, 2), undefined);
  assert.equal(selectCompositionAtSource({ ...input, clips: [] }, 2), undefined);
  assert.equal(selectCompositionAtSource({ ...input, clips: [{ id: 'bad', start: 4, end: 3 }] }, 2), undefined);
});
