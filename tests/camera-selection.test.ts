import assert from 'node:assert/strict';
import test from 'node:test';
import { getExportCanvasSize } from '../shared/canvas';
import { CAMERA_SHAPES, cameraShapePreset } from '../shared/camera-shapes';
import { webcamStyleAt } from '../shared/camera-layout';
import { compositionCameraStyle } from '../shared/composition-camera';
import { DEFAULT_STYLE } from '../shared/constants';
import { cameraAt } from '../shared/timeline';
import type { Project, WebcamStyle } from '../shared/types';
import { cameraSelectionState } from '../src/services/camera-selection';
import { drawWebcam } from '../src/services/webcam-compositor';

function project(width = 1280, height = 720): Project {
  return { id: 'selection-project', name: 'Camera selection fixture', createdAt: '2026-09-08', duration: 12,
    width, height, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.mp4' },
    camera: { offset: 0, enabled: true, position: 'bottom-right', size: .22, shape: 'circle', mirror: false, shrinkOnZoom: true },
    clips: [{ id: 'whole', start: 0, end: 12 }], cursor: [], zooms: [], style: { ...DEFAULT_STYLE },
    audio: { system: 1, microphone: 1 } };
}
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function drawnRect(style: WebcamStyle, width: number, height: number, zoom: number) {
  const rectangles: number[][] = [];
  const context = new Proxy({}, {
    get: (_, key) => key === 'roundRect' ? (...args: number[]) => rectangles.push(args) : () => {},
  }) as CanvasRenderingContext2D;
  drawWebcam(context, { width: 640, height: 480 } as HTMLCanvasElement, style, width, height, zoom);
  assert.ok(rectangles.length > 0);
  const [x, y, rectWidth, rectHeight, radius] = rectangles[0];
  return { x, y, width: rectWidth, height: rectHeight, radius };
}

test('selection uses source plus camera offset and never creates a hit area before camera media begins', () => {
  const input = project(); input.camera!.offset = 2;
  assert.ok(cameraSelectionState(input, 0), 'Positive offset means camera media is already available at screen zero');
  input.camera!.offset = -2;
  assert.equal(cameraSelectionState(input, 0), undefined);
  assert.equal(cameraSelectionState(input, 1.999), undefined);
  assert.ok(cameraSelectionState(input, 2));
  assert.ok(cameraSelectionState(input, 3));
});

test('caller-provided decoded-frame availability suppresses selection outside camera duration, including presenter and local overrides', () => {
  const input = project(); input.camera!.offset = 1;
  assert.ok(cameraSelectionState(input, 2, true));
  assert.equal(cameraSelectionState(input, 8, false), undefined);
  input.camera!.mode = 'presenter';
  assert.equal(cameraSelectionState(input, 8, false), undefined);
  input.compositions = [{ id: 'local', start: 7, end: 10, screen: 'hidden', camera: { visible: true, size: .6 } }];
  assert.equal(cameraSelectionState(input, 8, false), undefined);
  assert.ok(cameraSelectionState(input, 8, true));
});

test('missing media, missing camera settings, invalid time and ordinary hidden cameras have no hit region', () => {
  const input = project();
  for (const time of [NaN, Infinity]) assert.equal(cameraSelectionState(input, time), undefined);
  const noMedia = structuredClone(input); delete noMedia.media.camera;
  assert.equal(cameraSelectionState(noMedia, 2), undefined);
  const noCamera = structuredClone(input); delete noCamera.camera;
  assert.equal(cameraSelectionState(noCamera, 2), undefined);
  input.camera!.enabled = false;
  assert.equal(cameraSelectionState(input, 2), undefined);
  input.camera!.enabled = true;
  input.camera!.keyframes = [{ t: 0, x: .6, y: .7, size: .3, shape: 'circle', mirror: false, visible: false }];
  assert.equal(cameraSelectionState(input, 2), undefined);
});

test('local visibility overrides master and recorded visibility only inside its half-open interval', () => {
  const input = project(); input.camera!.enabled = false;
  input.compositions = [{ id: 'local', start: 2, end: 5, screen: 'hidden', camera: { visible: true, size: .6, x: .1, y: .2 } }];
  assert.equal(cameraSelectionState(input, 1.999), undefined);
  assert.ok(cameraSelectionState(input, 2));
  assert.ok(cameraSelectionState(input, 4.999));
  assert.equal(cameraSelectionState(input, 5), undefined);
  input.camera!.enabled = true; input.compositions[0].camera!.visible = false;
  assert.equal(cameraSelectionState(input, 3), undefined);
  assert.ok(cameraSelectionState(input, 5));
});

test('presenter uses full output bounds despite hidden small-window keyframes while respecting the master switch', () => {
  const input = project(); input.camera!.mode = 'presenter';
  input.camera!.keyframes = [{ t: 0, x: .8, y: .7, size: .3, shape: 'portrait', mirror: false, visible: false }];
  input.zooms = [{ id: 'zoom', start: 0, end: 10, x: .3, y: .4, scale: 2 }];
  const state = cameraSelectionState(input, 3)!;
  assert.deepEqual(state.rect, { x: 0, y: 0, width: state.output.width, height: state.output.height, radius: 0 });
  input.camera!.enabled = false;
  assert.equal(cameraSelectionState(input, 3), undefined);
});

test('local geometry takes precedence over presenter and presenter returns at the exact local end', () => {
  const input = project(); input.camera!.mode = 'presenter';
  input.compositions = [{ id: 'local', start: 2, end: 5, screen: 'hidden', camera: { size: .6, x: .1, y: .2, visible: true } }];
  const local = cameraSelectionState(input, 3)!;
  close(local.rect.x, local.output.width * .1); close(local.rect.y, local.output.height * .2);
  close(local.rect.width, Math.min(local.output.width, local.output.height) * .6);
  assert.ok(local.rect.width < local.output.width);
  assert.equal(cameraSelectionState(input, 5)!.rect.width, local.output.width);
  input.camera!.mode = 'overlay'; input.camera!.modeKeyframes = [{ t: 0, mode: 'overlay' }, { t: 6, mode: 'presenter' }];
  assert.equal(cameraSelectionState(input, 6)!.rect.width, local.output.width);
  input.camera!.useRecordedMode = false;
  assert.ok(cameraSelectionState(input, 6)!.rect.width < local.output.width);
});

test('all unedited shape, aspect, corner and placement hit bounds match actual drawWebcam clipping geometry', () => {
  for (const [width, height] of [[1280, 720], [720, 1280], [1080, 1080]]) {
    for (const shape of CAMERA_SHAPES) {
      for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
        const input = project(width, height); input.camera!.shape = shape; input.camera!.position = position;
        for (const placement of [undefined, { x: .01, y: .99 }, { x: .5, y: .5 }]) {
          input.camera!.placement = placement;
          const state = cameraSelectionState(input, 3)!;
          assert.deepEqual(state.rect, drawnRect(input.camera!, state.output.width, state.output.height, 1));
          close(state.rect.width / state.rect.height, cameraShapePreset(shape).aspect);
        }
      }
    }
  }
});

test('recorded movement interpolation, shape and disabled recorded layout follow the same source clock as rendering', () => {
  const input = project();
  input.camera!.keyframes = [
    { t: 0, x: .2, y: .2, size: .2, visible: true, shape: 'circle', mirror: false },
    { t: 2, x: .3, y: .4, size: .3, visible: true, shape: 'portrait', mirror: false },
    { t: 2.2, x: .5, y: .6, size: .4, visible: true, shape: 'landscape', mirror: true },
  ];
  for (const time of [1, 2, 2.1, 2.2, 4]) {
    const state = cameraSelectionState(input, time)!;
    assert.deepEqual(state.rect, drawnRect(webcamStyleAt(input.camera!, time), state.output.width, state.output.height, 1));
  }
  input.camera!.useRecordedLayout = false;
  const state = cameraSelectionState(input, 3)!;
  assert.deepEqual(state.rect, drawnRect(input.camera!, state.output.width, state.output.height, 1));
});

test('screen zoom shrinks ordinary camera bounds but never double-shrinks an explicit local size', () => {
  const input = project(); input.camera!.size = .4;
  input.zooms = [{ id: 'zoom', start: 0, end: 10, x: .5, y: .5, scale: 2 }];
  const output = getExportCanvasSize(input), zoom = cameraAt(input.zooms, 3).scale;
  const ordinary = cameraSelectionState(input, 3)!;
  close(ordinary.rect.width, Math.min(output.width, output.height) * .4 * .76);
  assert.deepEqual(ordinary.rect, drawnRect(input.camera!, output.width, output.height, zoom));
  input.compositions = [{ id: 'local', start: 2, end: 5, screen: 'recording', camera: { size: .6, x: .1, y: .2, shape: 'rounded' } }];
  const local = cameraSelectionState(input, 3)!;
  const effective = compositionCameraStyle(input.camera!, input.compositions[0].camera, output.width, output.height, zoom);
  assert.deepEqual(local.rect, drawnRect(effective, output.width, output.height, zoom));
  close(local.rect.width, Math.min(output.width, output.height) * .6);
  close(local.rect.x, output.width * .1); close(local.rect.y, output.height * .2);
});
