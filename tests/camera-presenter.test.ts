import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLE } from '../shared/constants';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import { outputToSourceTime } from '../shared/timeline';
import type { CameraEffects, Project, WebcamStyle } from '../shared/types';
import { getCanvasSize, renderFrame } from '../src/services/compositor';
import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import { sourceSize } from '../src/services/camera-effects/canvas';
import { disposeWebcamEffects, drawPresenter } from '../src/services/webcam-compositor';

type Matrix = [number, number, number, number];
interface Draw { source: CanvasImageSource; args: number[]; matrix: Matrix; shadow: number }
interface Fill { color: unknown; rect: number[]; alpha: number; composite: string }

/** Record canvas commands and evaluate their source coordinates without a browser or device. */
class RecordingContext {
  draws: Draw[] = []; fills: Fill[] = []; paths: string[] = [];
  matrix: Matrix = [1, 1, 0, 0]; fillStyle: unknown = '#000';
  shadowColor = 'transparent'; shadowBlur = 0; shadowOffsetY = 0;
  globalAlpha = 1; globalCompositeOperation = 'source-over';
  private stack: { matrix: Matrix; fillStyle: unknown; shadowColor: string; shadowBlur: number; shadowOffsetY: number;
    globalAlpha: number; globalCompositeOperation: string }[] = [];
  get context() { return this as unknown as CanvasRenderingContext2D; }
  save() { this.stack.push({ matrix: [...this.matrix], fillStyle: this.fillStyle,
    shadowColor: this.shadowColor, shadowBlur: this.shadowBlur, shadowOffsetY: this.shadowOffsetY,
    globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation }); }
  restore() { const saved = this.stack.pop(); assert.ok(saved, 'Unbalanced canvas restore'); Object.assign(this, saved); }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    assert.equal(b, 0); assert.equal(c, 0); this.matrix = [a, d, e, f];
  }
  translate(x: number, y: number) { this.matrix[2] += x * this.matrix[0]; this.matrix[3] += y * this.matrix[1]; }
  scale(x: number, y: number) { this.matrix[0] *= x; this.matrix[1] *= y; }
  clearRect() { this.draws = []; this.fills = []; this.paths = []; }
  createLinearGradient() { return { addColorStop() {} }; }
  fillRect(...rect: number[]) { this.fills.push({ color: this.fillStyle, rect, alpha: this.globalAlpha, composite: this.globalCompositeOperation }); }
  drawImage(source: CanvasImageSource, ...args: number[]) {
    this.draws.push({ source, args, matrix: [...this.matrix], shadow: this.shadowBlur });
  }
  beginPath() {}
  clip() {}
  fill() { this.paths.push('fill'); }
  stroke() { this.paths.push('stroke'); }
  roundRect() { this.paths.push('roundRect'); }
  rect() { this.paths.push('rect'); }
  arc() { this.paths.push('arc'); }
  moveTo() { this.paths.push('moveTo'); }
  lineTo() { this.paths.push('lineTo'); }
  closePath() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  assertRestored() { assert.equal(this.stack.length, 0); assert.deepEqual(this.matrix, [1, 1, 0, 0]); }
}

const screen = { width: 1920, height: 1080 } as HTMLCanvasElement;
const camera = { width: 1440, height: 1080 } as HTMLCanvasElement;
const baseCamera: WebcamStyle = { offset: 0, enabled: true, position: 'bottom-right', size: .22,
  mirror: false, shape: 'circle', shrinkOnZoom: true, placement: { x: .82, y: .76 },
  modeKeyframes: [{ t: 0, mode: 'overlay' }, { t: 3, mode: 'presenter' }, { t: 6, mode: 'overlay' }] };
function project(patch: Partial<WebcamStyle> = {}): Project {
  return { id: '568d996f-32e1-4e2b-8b56-aa4ea90721c7', name: 'Presenter fixture', createdAt: '2026-09-07T00:00:00Z',
    duration: 8, width: 1920, height: 1080, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' },
    camera: { ...baseCamera, ...patch }, cursor: [], clips: [{ id: 'clip', start: 0, end: 8 }], zooms: [],
    style: { ...DEFAULT_STYLE, showCursor: false }, audio: { system: 1, microphone: 1 } };
}
function render(active: Project, time: number, webcam: CanvasImageSource | undefined = camera) {
  const recorder = new RecordingContext(), size = getCanvasSize(active);
  renderFrame(recorder.context, screen, active, time, size.width, size.height, webcam);
  recorder.assertRestored(); return recorder;
}
function sourcePoint(draw: Draw, x: number, y: number) {
  const size = sourceSize(draw.source), args = draw.args;
  const [sx, sy, sw, sh] = args.length === 8 ? args.slice(0, 4) : [0, 0, size.width, size.height];
  const [dx, dy, dw, dh] = args.length === 8 ? args.slice(4) : args.length === 4 ? args : [...args, size.width, size.height];
  const [a, d, e, f] = draw.matrix;
  return { x: sx + (((x - e) / a - dx) / dw) * sw, y: sy + (((y - f) / d - dy) / dh) * sh };
}
function near(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`); }

test('mode cuts are exact and returning to PiP preserves the editable layout', () => {
  const active = project(), unchanged = structuredClone(active);
  for (const time of [0, 2.999, 6, 7.5]) {
    const actual = render(active, time), baseline = render(project({ modeKeyframes: undefined }), time);
    assert.deepEqual(actual.draws, baseline.draws); assert.deepEqual(actual.paths, baseline.paths);
    assert.deepEqual(actual.draws.map(draw => draw.source), [screen, camera]);
  }
  for (const time of [3, 5.999]) assert.deepEqual(render(active, time).draws.map(draw => draw.source), [camera]);
  assert.deepEqual(active, unchanged, 'Rendering must not overwrite the saved PiP geometry or mode history');
});

test('4:3 camera covers 16:9 without stretching, and mirror reverses only the horizontal source coordinates', () => {
  for (const mirror of [false, true]) {
    const recorder = new RecordingContext();
    drawPresenter(recorder.context, camera, { ...baseCamera, mirror }, 1920, 1080);
    assert.equal(recorder.draws.length, 1); const draw = recorder.draws[0];
    const topLeft = sourcePoint(draw, 0, 0), center = sourcePoint(draw, 960, 540), bottomRight = sourcePoint(draw, 1920, 1080);
    near(topLeft.x, mirror ? 1440 : 0); near(topLeft.y, 135);
    near(center.x, 720); near(center.y, 540);
    near(bottomRight.x, mirror ? 0 : 1440); near(bottomRight.y, 945);
    near(Math.abs(bottomRight.x - topLeft.x) / 1920, (bottomRight.y - topLeft.y) / 1080);
    assert.equal(draw.shadow, 0); assert.ok(!recorder.paths.includes('roundRect')); recorder.assertRestored();
  }
});

test('editor and export apply independent mirror overrides in PiP and presenter', () => {
  const input = project({ mirror: true, useRecordedMirror: false, useRecordedLayout: true,
    keyframes: [{ t: 0, x: .8, y: .7, size: .22, shape: 'circle', mirror: false, visible: true }] });
  for (const time of [1, 4]) {
    for (const mode of ['preview', 'source'] as const) {
      const recorder = new RecordingContext();
      renderFrame(recorder.context, screen, input, time, 1920, 1080, camera, mode);
      assert.equal(recorder.draws.find(draw => draw.source === camera)!.matrix[0], -1);
      recorder.assertRestored();
    }
  }
});

test('presenter ignores screen zoom, cursor, padding, shadow and small-window shape', () => {
  const active = project({ shape: 'portrait', size: .1, placement: { x: .1, y: .1 } });
  active.zooms = [{ id: 'zoom', start: 2, end: 6, x: .2, y: .7, scale: 3 }];
  active.cursor = [{ t: 4, x: .25, y: .6, visible: true, click: true }];
  active.style = { ...active.style, padding: 400, radius: 100, shadow: 200, showCursor: true, clickHighlight: true };
  const actual = render(active, 4), plain = render(project(), 4);
  assert.deepEqual(actual.draws, plain.draws); assert.deepEqual(actual.paths, []);
  assert.ok(actual.fills.some(fill => fill.color === '#13151a' && fill.rect.join() === '0,0,1920,1080'));
});

test('missing and master-disabled presenter cameras never reveal the desktop', () => {
  for (const [active, webcam] of [[project(), null], [project({ enabled: false }), camera]] as const) {
    const recorder = new RecordingContext();
    recorder.globalAlpha = .25; recorder.globalCompositeOperation = 'destination-over';
    renderFrame(recorder.context, screen, active, 4, 1920, 1080, webcam ?? undefined);
    assert.deepEqual(recorder.draws, [], 'Unavailable presenter media must never draw the underlying desktop');
    assert.deepEqual(recorder.fills, [{ color: '#13151a', rect: [0, 0, 1920, 1080], alpha: 1, composite: 'source-over' }]);
    assert.equal(recorder.globalAlpha, .25); assert.equal(recorder.globalCompositeOperation, 'destination-over');
    recorder.assertRestored();
  }
  assert.deepEqual(render(project({ enabled: false }), 6).draws.map(draw => draw.source), [screen]);
});

test('recorded PiP visibility stays independent from presenter mode and is restored on return', () => {
  const hidden = project({ keyframes: [{ t: 0, x: .8, y: .8, size: .22, shape: 'circle', mirror: true, visible: false }] });
  assert.deepEqual(render(hidden, 2).draws.map(draw => draw.source), [screen]);
  const presenter = render(hidden, 4);
  assert.deepEqual(presenter.draws.map(draw => draw.source), [camera]);
  near(sourcePoint(presenter.draws[0], 0, 0).x, 1440);
  assert.deepEqual(render(hidden, 6).draws.map(draw => draw.source), [screen]);
});

test('explicit project aspect stays fixed through presenter segments', () => {
  // The 1440x1080 fixture keeps its native tier rather than being enlarged to 1920x1080.
  for (const [aspect, expected] of [['16:9', [1440, 810]], ['9:16', [810, 1440]], ['1:1', [1080, 1080]], ['auto', [1440, 1080]]] as const) {
    const active = project(); active.width = 1440; active.height = 1080; active.style.aspect = aspect;
    assert.deepEqual(Object.values(getCanvasSize(active)), expected);
    const draw = render(active, 4).draws[0], a = sourcePoint(draw, 0, 0), b = sourcePoint(draw, expected[0], expected[1]);
    assert.ok(a.x >= -1e-7 && a.y >= -1e-7 && b.x <= 1440 + 1e-7 && b.y <= 1080 + 1e-7);
    near((b.x - a.x) / expected[0], (b.y - a.y) / expected[1]);
    assert.deepEqual(Object.values(getCanvasSize(active)), expected, 'A render cannot change the encoder dimensions');
  }
});

test('preview video and exported canvas use the same cut-adjusted source clock, independent of camera offset', () => {
  for (const offset of [-2, 2]) {
    const active = project({ offset }); active.clips = [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 4, end: 8 }];
    const video = { videoWidth: 1440, videoHeight: 1080, width: 160, height: 90 } as HTMLVideoElement;
    for (const [outputTime, presenter] of [[1.9, false], [2, true], [3.999, true], [4, false]] as const) {
      const sourceTime = outputToSourceTime(active.clips, outputTime);
      const preview = render(active, sourceTime, video), exported = render(active, sourceTime, camera);
      assert.equal(preview.draws.some(draw => draw.source === screen), !presenter);
      assert.equal(exported.draws.some(draw => draw.source === screen), !presenter);
      assert.deepEqual(preview.draws.map(({ args, matrix }) => ({ args, matrix })), exported.draws.map(({ args, matrix }) => ({ args, matrix })));
    }
  }
});

test('presenter and PiP share effect timing and reuse the renderer across consecutive frames', t => {
  const calls: { owner: CameraEffectsRenderer; source: CanvasImageSource; effects: CameraEffects }[] = [];
  t.mock.method(CameraEffectsRenderer.prototype, 'render', function (this: CameraEffectsRenderer, source: CanvasImageSource, effects: CameraEffects) {
    calls.push({ owner: this, source, effects }); return source;
  });
  const warm: CameraEffects = { ...DEFAULT_CAMERA_EFFECTS, filter: 'warm' };
  const cool: CameraEffects = { ...DEFAULT_CAMERA_EFFECTS, filter: 'cool' };
  const active = project({ effectKeyframes: [{ t: 0, effects: warm }, { t: 3, effects: cool }] });
  const recorder = new RecordingContext();
  try {
    for (const time of [2.99, 3, 4, 6]) renderFrame(recorder.context, screen, active, time, 1920, 1080, camera);
    assert.equal(calls.length, 4); assert.equal(new Set(calls.map(call => call.owner)).size, 1);
    assert.deepEqual(calls.map(call => call.effects.filter), ['warm', 'cool', 'cool', 'cool']);
    assert.ok(calls.every(call => call.source === camera)); recorder.assertRestored();
  } finally { disposeWebcamEffects(recorder.context); }
});
