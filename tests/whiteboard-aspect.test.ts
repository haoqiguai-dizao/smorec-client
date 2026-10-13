import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project } from '../shared/types';
import { renderFrame, getCanvasSize } from '../src/services/compositor';
import { screenGeometry } from '../src/services/compositor-decoration';
import { drawCameraWhiteboard } from '../src/services/whiteboard-camera-compositor';

function context() {
  let matrix = [1, 1, 0, 0]; const stack: number[][] = [], draws: { source: unknown; args: number[]; matrix: number[] }[] = [];
  const composites: unknown[] = [];
  const ctx = new Proxy({}, {
    set(_target, key, value) { if (key === 'globalCompositeOperation') composites.push(value); return true; },
    get(_target, key) {
      if (key === 'canvas') return { width: 1280, height: 720 };
      if (key === 'save') return () => stack.push([...matrix]);
      if (key === 'restore') return () => { matrix = stack.pop()!; };
      if (key === 'translate') return (x: number, y: number) => { matrix[2] += x * matrix[0]; matrix[3] += y * matrix[1]; };
      if (key === 'scale') return (x: number, y: number) => { matrix[0] *= x; matrix[1] *= y; };
      if (key === 'setTransform') return (a: number, _b: number, _c: number, d: number, e: number, f: number) => { matrix = [a, d, e, f]; };
      if (key === 'drawImage') return (source: unknown, ...args: number[]) => draws.push({ source, args, matrix: [...matrix] });
      if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
  }) as CanvasRenderingContext2D;
  return { ctx, draws, composites };
}
function fixture() {
  return { id: 'aspect', name: '', createdAt: '', duration: 4, width: 1280, height: 720, fps: 30,
    media: { screen: 'screen', camera: 'camera' }, cursor: [], zooms: [], clips: [{ id: 'all', start: 0, end: 4 }],
    style: { ...DEFAULT_STYLE, showCursor: false }, audio: { system: 0, microphone: 0 },
    camera: { enabled: true, offset: 0, size: .2, position: 'bottom-right', mirror: false, shape: 'rounded', shrinkOnZoom: false },
    whiteboard: { events: [{ t: 0, action: { kind: 'layout', visible: true, bounds: { x: 0, y: 0, width: 1, height: 1 }, backdrop: 'camera', shade: .4 } }] },
  } satisfies Project;
}
class InkCanvas {
  layer = context(); writes = 0;
  constructor(public width: number, public height: number) {}
  getContext() { return this.layer.ctx; }
}
function installCanvas(t: TestContext, value: typeof InkCanvas) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'OffscreenCanvas', original); else Reflect.deleteProperty(globalThis, 'OffscreenCanvas'); });
}
const camera = { width: 1280, height: 720 } as CanvasImageSource;
const screen = { width: 1280, height: 720 } as CanvasImageSource;

test('camera whiteboard retains the capture aspect and both source edges in every editor canvas aspect', t => {
  installCanvas(t, InkCanvas);
  for (const aspect of ['auto', '16:9', '9:16', '1:1'] as const) {
    const project = fixture(); project.style.aspect = aspect; project.style.padding = 64;
    const size = getCanvasSize(project), geometry = screenGeometry(project, size.width, size.height), actual = context();
    renderFrame(actual.ctx, screen, project, 2, size.width, size.height, camera);
    const draw = actual.draws.find(value => value.source === camera)!;
    assert.ok(draw.args.slice(0, 4).every((value, index) => Math.abs(value - [0, 0, 1280, 720][index]) < 1e-6),
      'Aspect edits must not crop away the recorded camera edges');
    assert.deepEqual(draw.args.slice(4), [-geometry.frameWidth / 2, -geometry.frameHeight / 2, geometry.frameWidth, geometry.frameHeight]);
    assert.deepEqual(draw.matrix, [1, 1, size.width / 2, size.height / 2]);
    assert.equal(actual.draws.filter(value => value.source instanceof InkCanvas).length, 1);
  }
});

test('camera board and ordinary source share focused placement in preview and export while presenter stays full canvas', t => {
  installCanvas(t, InkCanvas);
  const project: Project = fixture(); project.style.aspect = '9:16';
  project.zooms = [{ id: 'zoom', start: 0, end: 4, x: .4, y: .6, scale: 2 }];
  const size = getCanvasSize(project);
  for (const mode of ['preview', 'source'] as const) {
    const actual = context(); renderFrame(actual.ctx, screen, project, 2, size.width, size.height, camera, mode);
    const source = actual.draws.find(value => value.source === screen)!, board = actual.draws.find(value => value.source === camera)!;
    assert.ok(Math.abs(board.matrix[2] + board.args[4] - source.args[0]) < 1e-6);
    assert.ok(Math.abs(board.matrix[3] + board.args[5] - source.args[1]) < 1e-6);
    assert.deepEqual(board.args.slice(6), source.args.slice(2), 'Person/mask/ink must follow the same source zoom');
  }
  project.camera = { ...project.camera!, mode: 'presenter', useRecordedMode: false };
  const presenter = context(); renderFrame(presenter.ctx, screen, project, 2, size.width, size.height, camera);
  assert.equal(presenter.draws.filter(value => value.source === screen).length, 0);
  assert.deepEqual(presenter.draws.find(value => value.source === camera)!.args.slice(6), [size.width, size.height]);
});

test('fractional fitted sizes reuse integer ink buffers and legacy erasers affect only ink', t => {
  let allocations = 0, widthWrites = 0, heightWrites = 0;
  class Raster extends InkCanvas {
    constructor(width: number, height: number) {
      super(width, height); allocations++;
      Object.defineProperty(this, 'width', { get: () => width, set: value => { width = value; widthWrites++; } });
      Object.defineProperty(this, 'height', { get: () => height, set: value => { height = value; heightWrites++; } });
    }
  }
  installCanvas(t, Raster);
  const project: Project = fixture();
  project.whiteboard!.events.push({ t: 1, action: { kind: 'stroke', id: 'legacy-eraser', color: '#ffffff', size: 20, points: [{ x: 600, y: 350 }] } });
  const actual = context();
  for (let frame = 0; frame < 2; frame++) drawCameraWhiteboard(actual.ctx, camera, project, 2, 510.5, 287.15625, 'source');
  assert.equal(allocations, 1); assert.equal(widthWrites, 0); assert.equal(heightWrites, 0);
  const ink = actual.draws.find(draw => draw.source instanceof Raster)!;
  assert.deepEqual(ink.args, [0, 0, 510.5, 287.15625]);
  assert.ok((ink.source as Raster).layer.composites.includes('destination-out'));
  assert.ok(!actual.composites.includes('destination-out'), 'Eraser cannot punch through camera/shade');
  drawCameraWhiteboard(actual.ctx, camera, project, 2, 12800, 7200, 'source');
  assert.equal((ink.source as Raster).width, 1280); assert.equal((ink.source as Raster).height, 720);
  assert.equal(allocations, 1, 'Zooming cannot allocate a world-sized ink raster');
});
