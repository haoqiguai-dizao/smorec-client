import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLE } from '../shared/constants';
import { frameContentAt } from '../shared/frame-content';
import { compositionCameraRect } from '../shared/composition-camera';
import { boardCoversRecordedCamera } from '../shared/whiteboard/camera';
import type { CompositionSegment, Project } from '../shared/types';
import { cameraSelectionState } from '../src/services/camera-selection';
import { compositionTransformState } from '../src/services/composition-transform';
import { renderFrame } from '../src/services/compositor';
import { decodingFixture } from './fixtures/export-decoding';

function project(): Project {
  return { id: 'demo-edit', name: 'Demo editing regression', createdAt: '', duration: 6, width: 1280, height: 720, fps: 30,
    media: { screen: 'screen.mp4', camera: 'camera.mp4' }, clips: [{ id: 'clip', start: 0, end: 6 }],
    cursor: [], zooms: [], style: { ...DEFAULT_STYLE, padding: 0, radius: 0, showCursor: false }, audio: { system: 0, microphone: 0 },
    camera: { offset: 0, enabled: true, position: 'bottom-right', size: .25, shape: 'rounded', mirror: false, shrinkOnZoom: false },
    demoCapture: [{ start: 1, end: 4 }] };
}
function local(): CompositionSegment {
  return { id: 'local', start: 0, end: 6, screen: 'recording', camera: { visible: true, x: .3, y: .2, size: .4 } };
}
function board(input: Project, bounds = { x: 0, y: 0, width: 1, height: 1 }) {
  input.whiteboard = { separateCanvas: true, events: [
    { t: 0, action: { kind: 'layout', visible: true, presentation: 'canvas', bounds } },
  ] };
}

test('demo boundaries disable both direct selection and a previously selected transform only while camera is embedded', () => {
  const input = project(), segment = local(); input.compositions = [segment];
  for (const [time, editable] of [[.999, true], [1, false], [3.999, false], [4, true]] as const) {
    assert.equal(frameContentAt(input, time).camera, editable);
    assert.equal(!!cameraSelectionState(input, time), editable);
    assert.equal(compositionTransformState(input, segment, time)?.editable, editable);
  }
});

test('a screen replacement restores an independent editable person and returning to recording locks it again', () => {
  const input = project(), segment = local(); input.compositions = [segment];
  for (const screen of ['hidden', 'background', 'recording'] as const) {
    segment.screen = screen;
    const expected = screen !== 'recording';
    assert.equal(frameContentAt(input, 2).camera, expected);
    assert.equal(!!cameraSelectionState(input, 2), expected);
    assert.equal(compositionTransformState(input, segment, 2)?.editable, expected);
  }
});

test('transform state evaluates its own uncommitted segment instead of a stale project composition', () => {
  const input = project(), segment = local(); input.compositions = [segment];
  assert.equal(compositionTransformState(input, { ...segment, screen: 'hidden' }, 2)?.editable, true);
  assert.equal(compositionTransformState(input, segment, 2)?.editable, false);
});

test('an inactive selected segment evaluates its last included frame rather than the following demo boundary', () => {
  const input = project(), segment = { ...local(), end: 4 };
  assert.equal(compositionTransformState(input, segment, 5)?.editable, false);
});

test('a clean whiteboard enables camera editing only when it fully covers the recorded person', () => {
  const input = project(), segment = local(); input.compositions = [segment];
  const rect = compositionCameraRect(input.camera!, undefined, input.width, input.height);
  board(input, { x: rect.x / input.width, y: rect.y / input.height, width: rect.width / input.width, height: rect.height / input.height });
  assert.equal(boardCoversRecordedCamera(input, 2), true);
  assert.ok(cameraSelectionState(input, 2));
  assert.equal(compositionTransformState(input, segment, 2)?.editable, true);
  board(input, { x: rect.x / input.width, y: rect.y / input.height, width: rect.width / input.width / 2, height: rect.height / input.height });
  assert.equal(boardCoversRecordedCamera(input, 2), false);
  assert.equal(cameraSelectionState(input, 2), undefined);
  assert.equal(compositionTransformState(input, segment, 2)?.editable, false);
});

test('post-recording global edits never move the burned-in geometry used for board coverage', () => {
  const input = project();
  input.camera!.keyframes = [{ t: 0, x: .85, y: .8, size: .25, shape: 'rounded', mirror: false, visible: true }];
  board(input, { x: .7, y: .6, width: .3, height: .4 });
  assert.equal(boardCoversRecordedCamera(input, 2), true);
  input.camera = { ...input.camera!, placement: { x: .1, y: .1 }, size: .4, useRecordedLayout: false, enabled: false };
  assert.equal(boardCoversRecordedCamera(input, 2), true);
  board(input, { x: 0, y: 0, width: .3, height: .3 });
  assert.equal(boardCoversRecordedCamera(input, 2), false);
});

test('an embedded interface or a hidden board cannot unlock camera edits', () => {
  const input = project(); board(input);
  input.whiteboard!.interfaceCapture = 'screen';
  input.whiteboard!.events[0].action = { kind: 'layout', visible: true, presentation: 'interface',
    bounds: { x: 0, y: 0, width: 1, height: 1 } };
  assert.equal(cameraSelectionState(input, 2), undefined);
  board(input); input.whiteboard!.events[0].action = { kind: 'layout', visible: false, bounds: { x: 0, y: 0, width: 1, height: 1 } };
  assert.equal(cameraSelectionState(input, 2), undefined);
});

test('preview and export compositor draw the embedded screen once and render the camera after screen replacement', () => {
  const input = project(), segment = local(); input.compositions = [segment];
  const screen = { width: 1280, height: 720 } as HTMLCanvasElement, camera = { width: 320, height: 320 } as HTMLCanvasElement;
  for (const mode of ['preview', 'source'] as const) {
    const draws: unknown[] = [];
    const context = new Proxy({}, { get: (_, key) => key === 'drawImage' ? (source: unknown) => draws.push(source)
      : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} }) as CanvasRenderingContext2D;
    renderFrame(context, screen, input, 2, 1280, 720, camera, mode);
    assert.deepEqual(draws, [screen]);
    segment.screen = 'hidden'; draws.length = 0;
    renderFrame(context, screen, input, 2, 1280, 720, camera, mode);
    assert.deepEqual(draws, [camera]); segment.screen = 'recording';
  }
});

test('encoded export requests camera frames only in independent intervals, with the same half-open boundaries as editing', async () => {
  const input = project(), fixture = await decodingFixture();
  for await (const frame of fixture.decodeFrames(input, 12, 2, new AbortController().signal)) {
    assert.equal(!!frame.webcam, !!cameraSelectionState(input, frame.sourceTime));
  }
  assert.deepEqual(fixture.state.requested.filter(item => item.track === 'camera.mp4').map(item => item.time), [0, .5, 4, 4.5, 5, 5.5]);
});
