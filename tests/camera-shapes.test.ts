import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CAMERA_SHAPES, CAMERA_SHAPE_PRESETS, cameraShapeGeometry, isCameraShape, nextCameraShape, type CameraShape } from '../shared/camera-shapes';
import { webcamStyleAt } from '../shared/camera-layout';
import { outputToSourceTime } from '../shared/timeline';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project, RecordingControlAction, WebcamStyle } from '../shared/types';
import { parseProject } from '../electron/services/validation';
import { parseOverlayControl } from '../electron/services/recording-overlay/validation';
import { cameraOverlayBounds, cameraOverlayCenter } from '../electron/services/recording-overlay/geometry';
import { DesktopPreferences } from '../electron/services/desktop-preferences';
import { LiveRecordingControls } from '../electron/services/live-recording-controls';
import type { NativeClient } from '../electron/services/native-client';
import { drawWebcam } from '../src/services/webcam-compositor';

const camera: WebcamStyle = { enabled: true, offset: 0, shape: 'rounded', position: 'bottom-right', size: .3, mirror: false, shrinkOnZoom: false };
function project(style: WebcamStyle): Project {
  return { id: '50c497b4-47e2-4ced-a56b-7b4dc2d3b727', name: 'Shapes', createdAt: '2026-09-07T00:00:00Z',
    duration: 12, width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' }, camera: style,
    clips: [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 8, end: 12 }], cursor: [], zooms: [],
    style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
}

test('the six shape presets preserve legacy geometry and fit without changing aspect or corner shape', () => {
  assert.deepEqual(cameraShapeGeometry('circle', 220), { width: 220, height: 220, radius: 110 });
  assert.deepEqual(cameraShapeGeometry('rounded', 220), { width: 220, height: 176, radius: 35.2 });
  assert.equal(new Set(CAMERA_SHAPE_PRESETS.map(preset => preset.id)).size, 6);
  for (const preset of CAMERA_SHAPE_PRESETS) {
    const frame = cameraShapeGeometry(preset.id, 240, 100, 90);
    assert.ok(frame.width <= 100 && frame.height <= 90);
    assert.ok(Math.abs(frame.width / frame.height - preset.aspect) < 1e-12);
    assert.ok(frame.radius <= Math.min(frame.width, frame.height) / 2);
  }
  assert.deepEqual(cameraShapeGeometry('capsule', 120), { width: 120, height: 120, radius: 38.4 });
  let shape: CameraShape = CAMERA_SHAPES[0]; for (let index = 0; index < 6; index++) shape = nextCameraShape(shape);
  assert.equal(shape, 'circle');
});

test('floating geometry uses all preset ratios and stays on small or negatively positioned displays', () => {
  for (const area of [{ x: -1920, y: -900, width: 1920, height: 1080 }, { x: -250, y: 30, width: 250, height: 160 }]) {
    for (const shape of CAMERA_SHAPES) for (const size of [.12, .42]) for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: .5, y: .5 }]) {
      const box = cameraOverlayBounds(area, size, point, shape);
      const frame = cameraShapeGeometry(shape, Math.round(Math.min(area.width, area.height) * size));
      assert.equal(box.width, Math.round(frame.width) + 12); assert.equal(box.height, Math.round(frame.height) + 12);
      assert.ok(box.x >= area.x && box.y >= area.y && box.x + box.width <= area.x + area.width && box.y + box.height <= area.y + area.height);
      const center = cameraOverlayCenter(box, area); assert.ok(center.x >= 0 && center.x <= 1 && center.y >= 0 && center.y <= 1);
    }
  }
  const fallback = cameraOverlayBounds({ x: -200, y: 0, width: 200, height: 200 }, NaN, { x: NaN, y: Infinity }, 'capsule');
  assert.ok(Object.values(fallback).every(Number.isFinite));
});

test('project and live schemas accept only the shared shape set including recorded source-time changes', () => {
  const frames = CAMERA_SHAPES.map((shape, index) => ({ t: index * 2, x: .5, y: .5, size: .3, shape, mirror: true, visible: true }));
  const stored = project({ ...camera, keyframes: frames, useRecordedLayout: true });
  assert.deepEqual(parseProject(stored).camera?.keyframes, frames);
  for (const shape of CAMERA_SHAPES) {
    assert.equal(isCameraShape(shape), true);
    assert.equal(parseProject(project({ ...camera, shape })).camera?.shape, shape);
    assert.deepEqual(parseOverlayControl({ type: 'camera-shape', value: shape }), { type: 'camera-shape', value: shape });
  }
  for (const shape of ['triangle', '', null, 1, {}, '__proto__']) {
    assert.equal(isCameraShape(shape), false);
    assert.throws(() => parseProject(project({ ...camera, shape } as WebcamStyle)));
    assert.throws(() => parseOverlayControl({ type: 'camera-shape', value: shape }));
  }
  assert.equal(webcamStyleAt(stored.camera!, outputToSourceTime(stored.clips, 2)).shape, 'landscape');
  assert.equal(webcamStyleAt(stored.camera!, 9.999).shape, 'landscape');
  assert.equal(webcamStyleAt(stored.camera!, 10).shape, 'capsule');
  assert.equal(webcamStyleAt({ ...stored.camera!, shape: 'square', useRecordedLayout: false }, 10).shape, 'square');
});

test('all shapes persist through live keyframes and restarted preferences without native calls', async context => {
  const output = path.resolve('output/camera-shapes-tests'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'profile-'));
  const preferences = new DesktopPreferences(() => directory); let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const native = { request: async () => { throw new Error('Shape changes must not restart capture or invoke native'); } } as unknown as NativeClient;
  const controls = new LiveRecordingControls(native, () => ({ status: 'recording' }), () => {}, preferences);
  controls.reset({ sourceId: 'screen:fixture', fps: 30, microphone: false, systemAudio: false, cameraSessionId: 'fixture' });
  controls.start(now);
  for (const shape of CAMERA_SHAPES) {
    now += 1000; await controls.control({ type: 'camera-shape', value: shape }); preferences.flush();
    assert.equal(controls.snapshot().cameraShape, shape);
    assert.equal(controls.keyframes(20).at(-1)?.shape, shape);
    assert.equal(new DesktopPreferences(() => directory).read().camera.shape, shape);
  }
  await assert.rejects(controls.control({ type: 'camera-shape', value: 'triangle' } as unknown as RecordingControlAction));
  controls.reset({ sourceId: 'screen:fixture', fps: 30, microphone: false, systemAudio: false, cameraSessionId: 'fixture' });
  assert.equal(controls.snapshot().cameraShape, 'capsule');
  assert.deepEqual(parseProject(project({ ...camera, keyframes: CAMERA_SHAPES.map((shape, index) => ({ t: index, shape, x: .5, y: .5, size: .3, mirror: true, visible: true })) })).camera?.keyframes?.map(frame => frame.shape), CAMERA_SHAPES);
});

test('the shared preview/export compositor covers each shape with an undistorted centered crop', () => {
  for (const shape of CAMERA_SHAPES) for (const source of [{ width: 1280, height: 720 }, { width: 640, height: 480 }, { width: 480, height: 640 }]) {
    const rectangles: number[][] = [], draws: number[][] = [], translations: number[][] = [], mirrors: number[][] = [];
    const ctx = { save() {}, restore() {}, beginPath() {}, fill() {}, clip() {},
      roundRect: (...args: number[]) => rectangles.push(args), translate: (...args: number[]) => translations.push(args),
      scale: (...args: number[]) => mirrors.push(args), drawImage: (_source: unknown, ...args: number[]) => draws.push(args) } as unknown as CanvasRenderingContext2D;
    drawWebcam(ctx, source as CanvasImageSource, { ...camera, shape, placement: { x: 1, y: 1 }, mirror: true }, 1280, 720, 1);
    const frame = cameraShapeGeometry(shape, 720 * .3), rectangle = rectangles.at(-1)!;
    assert.deepEqual(rectangle, [1280 - frame.width, 720 - frame.height, frame.width, frame.height, frame.radius]);
    const [left, top, width, height] = draws[0];
    assert.ok(Math.abs(width / source.width - height / source.height) < 1e-12, 'Uniform scaling must preserve faces');
    assert.ok(width >= frame.width && height >= frame.height, 'Cover crop must fill the preset');
    assert.equal(left, -width / 2); assert.equal(top, -height / 2);
    assert.deepEqual(translations[0], [1280 - frame.width / 2, 720 - frame.height / 2]);
    assert.deepEqual(mirrors, [[-1, 1]]);
  }
});
