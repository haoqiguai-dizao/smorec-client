import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLE } from '../shared/constants';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import type { Project } from '../shared/types';
import { renderFrame } from '../src/services/compositor';
import { disposeWebcamEffects } from '../src/services/webcam-compositor';
import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import { sourceSize } from '../src/services/camera-effects/canvas';
import { disposeCompositionDecoration } from '../src/services/compositor-decoration';

test('4K camera effects follow the preview rectangle while default export retains source pixels', t => {
  const canvases: { width: number; height: number; getContext: () => object }[] = [];
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => {
      const canvas = { width: 1, height: 1, getContext: () => new Proxy({}, { get: (_target, key) => key === 'createLinearGradient'
        ? () => ({ addColorStop() {} }) : () => {} }) };
      canvases.push(canvas); return canvas;
    },
  } });
  const inputs: { width: number; height: number; source: CanvasImageSource; owner: CameraEffectsRenderer }[] = [];
  t.mock.method(CameraEffectsRenderer.prototype, 'render', function (this: CameraEffectsRenderer, source: CanvasImageSource) {
    inputs.push({ ...sourceSize(source), source, owner: this }); return source;
  });
  // Canvas commands are observed without allocating or processing any actual 4K pixels.
  const context = new Proxy({}, { get: (_target, key) => key === 'createLinearGradient'
    ? () => ({ addColorStop() {} }) : () => {} }) as CanvasRenderingContext2D;
  t.after(() => {
    disposeWebcamEffects(context);
    disposeCompositionDecoration(context);
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  const camera = { videoWidth: 3840, videoHeight: 2160 } as HTMLVideoElement;
  const screen = { width: 3840, height: 2160 } as HTMLCanvasElement;
  const project: Project = { id: '4k-preview', name: '4K preview', createdAt: '', duration: 1,
    width: 3840, height: 2160, fps: 60, media: { screen: 'screen.mp4', camera: 'camera.mp4' },
    clips: [{ id: 'clip', start: 0, end: 1 }], cursor: [], zooms: [], audio: { system: 0, microphone: 0 },
    style: { ...DEFAULT_STYLE, showCursor: false }, camera: { offset: 0, enabled: true, position: 'bottom-right',
      size: .25, mirror: true, shape: 'circle', shrinkOnZoom: false, effects: { ...DEFAULT_CAMERA_EFFECTS } } };
  const dimensions = () => { const input = inputs.at(-1)!; return [input.width, input.height]; };

  renderFrame(context, screen, project, 0, 1280, 720, camera, 'preview');
  assert.deepEqual(dimensions(), [320, 180], '180px circle needs the 16:9 source to cover its height');
  assert.notEqual(inputs.at(-1)!.source, camera, 'Resize must happen before the effect renderer');
  const previewOwner = inputs.at(-1)!.owner;
  renderFrame(context, screen, project, 0, 2560, 1440, camera, 'preview');
  assert.deepEqual(dimensions(), [640, 360], 'DPR is already included in the backing canvas; do not multiply it again');
  assert.equal(inputs.at(-1)!.owner, previewOwner, 'Resizing reuses the preview effect renderer');
  assert.equal(canvases.length, 2, 'Preview staging and the single decoration layer are reusable');

  project.camera!.shape = 'portrait';
  renderFrame(context, screen, project, 0, 1280, 720, camera, 'preview');
  assert.deepEqual(dimensions(), [427, 240], 'Tall shapes budget their covered source rather than only their width');
  project.camera!.mode = 'presenter';
  renderFrame(context, screen, project, 0, 1280, 720, camera, 'preview');
  assert.deepEqual(dimensions(), [1280, 720], 'Presenter preview uses the entire preview canvas');

  for (const mode of ['overlay', 'presenter'] as const) {
    project.camera!.mode = mode;
    renderFrame(context, screen, project, 0, 3840, 2160, camera);
    assert.deepEqual(dimensions(), [3840, 2160], 'Export defaults to full source effects regardless of layout');
    assert.equal(inputs.at(-1)!.source, camera);
    assert.notEqual(inputs.at(-1)!.owner, previewOwner, 'Preview staging cannot contaminate source rendering');
  }
  assert.deepEqual(sourceSize(camera), { width: 3840, height: 2160 }, 'Original camera media is never resized');
  const count = inputs.length;
  project.camera!.enabled = false;
  renderFrame(context, screen, project, 0, 1280, 720, camera, 'preview');
  assert.equal(inputs.length, count, 'Disabled camera performs no effect work');
  disposeWebcamEffects(context);
  disposeCompositionDecoration(context);
  assert.ok(canvases.every(canvas => canvas.width === 1 && canvas.height === 1), 'Cleanup releases preview staging');
});
