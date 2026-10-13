import assert from 'node:assert/strict';
import test from 'node:test';
import { CAMERA_SHAPES } from '../shared/camera-shapes';
import { DEFAULT_STYLE } from '../shared/constants';
import { updateCompositionSegment } from '../shared/composition';
import type { CompositionSegment, Project } from '../shared/types';
import { COMPOSITION_PRESETS, compositionPresetPatch } from '../src/services/composition-presets';
import { compositionTransformState } from '../src/services/composition-transform';

const backgroundId = 'asset:550e8400-e29b-41d4-a716-446655440000';
function fixture(width = 1280, height = 720): Project {
  return { id: 'preset-project', name: 'Preset fixture', createdAt: '2026-09-08', width, height, duration: 12, fps: 30,
    media: { screen: 'synthetic-screen', camera: 'synthetic-camera' }, cursor: [], zooms: [],
    clips: [{ id: 'clip', start: 0, end: 12 }], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 },
    camera: { offset: 0, enabled: true, position: 'bottom-right', size: .22, shape: 'circle', mirror: true, shrinkOnZoom: true },
    compositions: [{ id: 'selected', start: 2, end: 5, screen: 'background', background: backgroundId,
      camera: { x: .3, y: .3, size: .22, shape: 'rounded', mirror: false, visible: false } },
    { id: 'other', start: 6, end: 8, screen: 'hidden', camera: { size: .4 } }] };
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function apply(project: Project, preset: typeof COMPOSITION_PRESETS[number], segment = project.compositions![0]) {
  const patch = compositionPresetPatch(project, segment, 3, preset)!;
  return { patch, segment: { ...segment, ...patch } as CompositionSegment };
}

test('bottom-right preset uses 22% short-edge width and the existing 3.5% composition margin', () => {
  const project = fixture(), { segment } = apply(project, 'bottom-right');
  const { rect, output } = compositionTransformState(project, segment, 3)!;
  const short = Math.min(output.width, output.height);
  close(rect.width, short * .22); close(output.width - rect.x - rect.width, short * .035);
  close(output.height - rect.y - rect.height, short * .035);
});

test('reaction preset keeps the current center, grows toward 70%, and never shrinks an already larger person', () => {
  for (const [initial, expected] of [[.22, .42], [.4, .56], [.6, .7], [.9, .9]]) {
    const project = fixture(), selected = project.compositions![0];
    selected.camera = { ...selected.camera, x: .2, y: .12, size: initial };
    const before = compositionTransformState(project, selected, 3)!.rect;
    const { segment } = apply(project, 'reaction'), after = compositionTransformState(project, segment, 3)!.rect;
    close(segment.camera!.size!, expected);
    close(after.x + after.width / 2, before.x + before.width / 2);
    close(after.y + after.height / 2, before.y + before.height / 2);
  }
});

test('reaction growth respects fitted shape limits without turning a smaller person into full screen', () => {
  for (const [width, height] of [[1280, 720], [720, 1280]]) {
    for (const shape of CAMERA_SHAPES) {
      for (const initial of [.22, .65, .9, 1.5]) {
        const project = fixture(width, height), selected = project.compositions![0];
        selected.camera = { ...selected.camera, shape, size: initial, x: .1, y: .1 };
        const before = compositionTransformState(project, selected, 3)!;
        const { segment } = apply(project, 'reaction'), after = compositionTransformState(project, segment, 3)!;
        assert.ok(after.rect.width >= before.rect.width - 1e-8);
        assert.ok(after.rect.height >= before.rect.height - 1e-8);
        close(after.rect.width / after.rect.height, before.rect.width / before.rect.height);
        if (initial < .7) assert.ok(after.rect.width < after.output.width && after.rect.height < after.output.height);
      }
    }
  }
});

test('centered presets remain movable windows and only person-only hides the desktop', () => {
  for (const preset of ['centered', 'person-only'] as const) {
    const project = fixture(), { patch, segment } = apply(project, preset);
    const { rect, output } = compositionTransformState(project, segment, 3)!;
    close(segment.camera!.size!, preset === 'centered' ? .5 : .6);
    close(rect.x + rect.width / 2, output.width / 2); close(rect.y + rect.height / 2, output.height / 2);
    assert.equal(segment.screen, preset === 'person-only' ? 'hidden' : 'background');
    assert.equal('background' in patch, false); assert.equal(segment.background, backgroundId);
    assert.ok(rect.width < output.width && rect.height < output.height);
  }
});

test('all presets fit each shape and output orientation while preserving mirror, shape and unrelated state', () => {
  for (const [width, height] of [[1280, 720], [720, 1280], [1080, 1080]]) {
    for (const shape of CAMERA_SHAPES) {
      for (const preset of COMPOSITION_PRESETS) {
        const project = fixture(width, height), selected = project.compositions![0];
        selected.camera = { ...selected.camera, shape, x: .97, y: .97 };
        const original = structuredClone(project), { patch, segment } = apply(project, preset);
        const { rect, output } = compositionTransformState(project, segment, 3)!;
        assert.equal(segment.camera!.shape, shape); assert.equal(segment.camera!.mirror, false); assert.equal(segment.camera!.visible, true);
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= output.width + 1e-8 && rect.y + rect.height <= output.height + 1e-8);
        if (preset !== 'person-only') assert.equal('screen' in patch, false);
        const updated = updateCompositionSegment(project.compositions!, selected.id, patch, project.duration);
        assert.deepEqual(updated[0], segment, 'The patch must be accepted as one selected-segment update');
        assert.deepEqual(updated[1], original.compositions![1]);
        assert.equal(updated[0].start, selected.start); assert.equal(updated[0].end, selected.end);
        assert.deepEqual(project, original, 'Preset helper must not mutate project or recorded tracks');
      }
    }
  }
});

test('presets use the effective recorded camera when overrides are absent and decline missing media', () => {
  const project = fixture(), selected = project.compositions![0];
  selected.camera = undefined;
  project.camera!.keyframes = [{ t: 0, x: .5, y: .5, size: .3, shape: 'portrait', mirror: true, visible: false }];
  project.camera!.useRecordedLayout = true;
  const { segment } = apply(project, 'reaction');
  const state = compositionTransformState(project, segment, 3)!;
  close(state.rect.width / state.rect.height, .75); assert.equal(state.style.mirror, true);
  assert.equal(segment.camera!.visible, true);
  const unavailable = structuredClone(project); delete unavailable.media.camera;
  assert.equal(compositionPresetPatch(unavailable, selected, 3, 'centered'), undefined);
  delete unavailable.camera;
  assert.equal(compositionPresetPatch(unavailable, selected, 3, 'centered'), undefined);
  assert.equal(compositionPresetPatch(project, selected, NaN, 'centered'), undefined);
});
