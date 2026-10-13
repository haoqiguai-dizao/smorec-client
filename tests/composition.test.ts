import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_STYLE } from '../shared/constants';
import { compositionAt, createCompositionSegment, removeCompositionSegment, splitCompositionSegment,
  updateCompositionSegment, upsertCompositionSegment } from '../shared/composition';
import { compositionCameraMaxSize, compositionCameraRect, compositionCameraStyle } from '../shared/composition-camera';
import { webcamStyleAt } from '../shared/camera-layout';
import { cameraAt, outputToSourceTime } from '../shared/timeline';
import type { CompositionSegment, Project, WebcamStyle } from '../shared/types';
import { renderFrame } from '../src/services/compositor';

const webcam: WebcamStyle = { offset: 0.5, enabled: true, position: 'bottom-right', size: 0.22,
  mirror: true, shape: 'circle', shrinkOnZoom: true };
const segment = (id = 'local', start = 2, end = 4): CompositionSegment => ({ id, start, end, screen: 'recording',
  camera: { x: 0.1, y: 0.2, size: 0.65, visible: true } });
function project(): Project {
  return { id: 'project', name: 'Composition fixture', createdAt: '2026-09-08', duration: 10, width: 1280, height: 720,
    fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' }, camera: { ...webcam }, cursor: [], zooms: [],
    clips: [{ id: 'clip', start: 0, end: 10 }], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
}

test('composition intervals are half-open and absent metadata leaves every time untouched', () => {
  const first = segment('first', 1, 3), second = segment('second', 3, 4);
  const segments = [first, second];
  assert.equal(compositionAt(undefined, 2), undefined);
  assert.equal(compositionAt([], 2), undefined);
  assert.equal(compositionAt(segments, 0.99), undefined);
  assert.equal(compositionAt(segments, 1), first);
  assert.equal(compositionAt(segments, 2.999), first);
  assert.equal(compositionAt(segments, 3), second);
  assert.equal(compositionAt(segments, 4), undefined);
  assert.equal(compositionAt(segments, NaN), undefined);
  assert.equal(compositionAt(segments, Infinity), undefined);
});

test('local composition follows source cuts rather than output time or camera offset', () => {
  const clips = [{ id: 'later', start: 3, end: 5 }, { id: 'earlier', start: 0, end: 2 }];
  const local = segment();
  assert.equal(compositionAt([local], outputToSourceTime(clips, 0.5)), local);
  assert.equal(compositionAt([local], outputToSourceTime(clips, 2)), undefined);
});

test('creation snapshots the current small-window geometry and does not enlarge or center it', () => {
  const input = project();
  input.camera!.keyframes = [{ t: 0, x: 0.8, y: 0.7, size: 0.3, shape: 'rounded', visible: true, mirror: false }];
  input.zooms = [{ id: 'zoom', start: 0, end: 10, x: 0.5, y: 0.5, scale: 1.7 }];
  const snapshot = structuredClone(input);
  const created = createCompositionSegment(input, 2, 4, 'chosen-id');
  const before = compositionCameraRect(webcamStyleAt(input.camera!, 2), undefined, 1280, 720, cameraAt(input.zooms, 2).scale);
  const after = compositionCameraRect(webcamStyleAt(input.camera!, 2), created.camera, 1280, 720, 1.7);
  assert.equal(created.id, 'chosen-id');
  assert.equal(created.screen, 'recording');
  assert.equal(created.camera!.shape, 'rounded');
  assert.equal(created.camera!.mirror, false);
  for (const key of ['x', 'y', 'width', 'height'] as const) assert.ok(Math.abs(after[key] - before[key]) < 1e-10);
  assert.deepEqual(input, snapshot);
  assert.throws(() => createCompositionSegment(input, 3, 3), /时间范围/);
});

test('creation without camera media does not invent a camera override', () => {
  const input = project(); delete input.camera; delete input.media.camera;
  assert.deepEqual(createCompositionSegment(input, 1, 2, 'screen-only'), { id: 'screen-only', start: 1, end: 2, screen: 'recording' });
});

test('creating a local camera over presenter or hidden content cannot silently reveal the desktop', () => {
  const input = project(); input.camera!.mode = 'presenter';
  const created = createCompositionSegment(input, 2, 4, 'presenter-edit');
  assert.equal(created.screen, 'hidden');
  assert.equal(created.camera!.size, webcam.size, 'Privacy protection must not force the camera full-screen');
  input.compositions = [{ ...segment(), screen: 'background', background: 'asset:existing' }];
  const background = createCompositionSegment(input, 3, 5, 'background-edit');
  assert.equal(background.screen, 'background');
  assert.equal(background.background, 'asset:existing');
});

test('creation at presenter preserves the visible presenter despite a hidden recorded small window', () => {
  const input = project();
  input.camera!.modeKeyframes = [{ t: 0, mode: 'overlay' }, { t: 1, mode: 'presenter' }];
  input.camera!.keyframes = [{ t: 0, x: 0.8, y: 0.7, size: 0.3, shape: 'rounded', visible: false, mirror: false }];
  const snapshot = structuredClone(input);
  assert.equal(webcamStyleAt(input.camera!, 2).enabled, false);
  const created = createCompositionSegment(input, 2, 4);
  assert.equal(created.screen, 'hidden');
  assert.equal(created.camera!.visible, true);
  assert.equal(created.camera!.size, 0.3, 'Visibility must not change the retained small-window geometry');
  assert.deepEqual(input, snapshot);
  assert.equal(createCompositionSegment(input, 0, 0.5).camera!.visible, false, 'Ordinary overlay still inherits recorded visibility');
});

test('creation at presenter preserves the disabled global camera switch', () => {
  const input = project();
  input.camera!.mode = 'presenter'; input.camera!.enabled = false;
  input.camera!.keyframes = [{ t: 0, x: 0.8, y: 0.7, size: 0.3, shape: 'rounded', visible: true, mirror: false }];
  const created = createCompositionSegment(input, 2, 4);
  assert.equal(created.screen, 'hidden');
  assert.equal(created.camera!.visible, false);
});

test('creation preserves an existing local visibility override ahead of presenter and global switches', () => {
  const input = project(); input.camera!.mode = 'presenter';
  for (const visible of [true, false]) {
    input.camera!.enabled = !visible;
    input.compositions = [{ ...segment(), screen: 'hidden', camera: { visible } }];
    assert.equal(createCompositionSegment(input, 3, 5).camera!.visible, visible);
  }
  input.camera!.enabled = true;
  input.camera!.keyframes = [{ t: 0, x: 0.8, y: 0.7, size: 0.3, shape: 'rounded', visible: false, mirror: false }];
  input.compositions = [{ ...segment(), screen: 'hidden', camera: { size: 0.4 } }];
  assert.equal(createCompositionSegment(input, 3, 5).camera!.visible, false,
    'An existing ordinary local segment with inherited visibility must not gain presenter visibility');
});

test('a newly selected range crossing a later presenter interval defaults to hiding the screen', () => {
  const input = project();
  input.camera!.modeKeyframes = [{ t: 0, mode: 'overlay' }, { t: 3, mode: 'presenter' }, { t: 5, mode: 'overlay' }];
  assert.equal(createCompositionSegment(input, 1, 4).screen, 'hidden');
  assert.equal(createCompositionSegment(input, 1, 3).screen, 'recording', 'The exclusive end must not include a later presenter cut');
  assert.equal(createCompositionSegment(input, 5, 7).screen, 'recording');
  input.camera!.useRecordedMode = false;
  assert.equal(createCompositionSegment(input, 1, 4).screen, 'recording', 'Disabled recorded modes cannot affect a new range');
});

test('upserts sort detached segments and reject overlaps without touching neighboring work', () => {
  const original = [segment('first', 1, 3), segment('last', 6, 8)];
  const snapshot = structuredClone(original);
  for (const incoming of [segment('bad', 2, 4), segment('bad', 0, 10), segment('bad', -1, 1), segment('bad', 2, 11)]) {
    assert.equal(upsertCompositionSegment(original, incoming, 10), original);
  }
  const incoming = segment('middle', 3, 6), result = upsertCompositionSegment(original, incoming, 10);
  assert.deepEqual(result.map(({ id }) => id), ['first', 'middle', 'last']);
  incoming.camera!.x = 0.8;
  assert.equal(result[1].camera!.x, 0.1);
  assert.deepEqual(original, snapshot);
});

test('local updates merge only the camera patch and never overwrite another interval', () => {
  const original = [segment('first', 1, 3), segment('last', 6, 8)];
  const result = updateCompositionSegment(original, 'first', { camera: { size: 0.75, visible: false }, screen: 'hidden' }, 10);
  assert.deepEqual(result[0].camera, { x: 0.1, y: 0.2, size: 0.75, visible: false });
  assert.equal(result[1], original[1]);
  assert.equal(original[0].camera!.size, 0.65);
  assert.equal(updateCompositionSegment(original, 'first', { end: 7 }, 10), original);
  assert.equal(updateCompositionSegment(original, 'missing', { end: 7 }, 10), original);
});

test('invalid local camera fields or background references cannot enter an editable draft', () => {
  const original = [segment('first', 1, 3)];
  const invalid = [
    { camera: { x: NaN } }, { camera: { y: Infinity } }, { camera: { x: -0.01 } }, { camera: { y: 1.1 } },
    { camera: { size: 0.07 } }, { camera: { size: 2.1 } }, { camera: { visible: 1 } }, { camera: { mirror: 'false' } },
    { camera: { shape: 'triangle' } }, { camera: { unexpected: true } }, { camera: null },
    { screen: 'image' }, { screen: 'background' }, { screen: 'background', background: 123 },
    { background: 'file:///private/image.png' }, { background: 'asset:invalid' }, { background: null },
  ];
  for (const patch of invalid) {
    assert.equal(updateCompositionSegment(original, 'first', patch as never, 10), original, JSON.stringify(patch));
    assert.equal(upsertCompositionSegment(original, { ...segment('new', 4, 6), ...patch } as CompositionSegment, 10), original);
  }
  assert.equal(upsertCompositionSegment(original, null as unknown as CompositionSegment, 10), original);
  const valid = updateCompositionSegment(original, 'first', { screen: 'background', background: 'mint' }, 10);
  assert.equal(valid[0].background, 'mint');
  const asset = updateCompositionSegment(original, 'first', { screen: 'background',
    background: 'asset:9a40b932-596f-402a-a47e-c1a55227cb7e' }, 10);
  assert.equal(asset[0].screen, 'background');
});

test('split preserves both visual states and deletion restores the underlying composition', () => {
  const original = [segment('first', 1, 5)];
  const result = splitCompositionSegment(original, 'first', 3, 'second');
  assert.deepEqual(result.map(({ id, start, end }) => ({ id, start, end })),
    [{ id: 'first', start: 1, end: 3 }, { id: 'second', start: 3, end: 5 }]);
  assert.deepEqual(result[0].camera, result[1].camera);
  result[1].camera!.size = 0.8;
  assert.equal(result[0].camera!.size, 0.65);
  assert.equal(original[0].end, 5);
  for (const at of [1, 5, NaN, Infinity]) assert.equal(splitCompositionSegment(original, 'first', at), original);
  assert.equal(splitCompositionSegment(original, 'first', 3, 'first'), original);
  assert.deepEqual(removeCompositionSegment(original, 'first'), []);
  assert.equal(removeCompositionSegment(original, 'absent'), original);
});

test('local sizes are continuous, support medium and large windows, and fit every output edge', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
    for (const shape of ['circle', 'portrait', 'landscape'] as const) {
      let previous = 0;
      const max = compositionCameraMaxSize(shape, width, height);
      for (const size of [0.12, 0.35, 0.55, 0.75, max]) {
        const rect = compositionCameraRect(webcam, { shape, size, x: 0.99, y: 0.99 }, width, height);
        assert.ok(rect.width >= previous); previous = rect.width;
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1e-9 && rect.y + rect.height <= height + 1e-9);
      }
    }
  }
  const local = compositionCameraStyle(webcam, { x: 0.1, y: 0.2, size: 0.6 }, 1280, 720, 1.7);
  assert.equal(local.size, 0.6, 'Local size cannot be clamped to the 42% live limit or shrunk by screen zoom');
  assert.equal(local.shrinkOnZoom, false);
});

test('local visibility, shape and mirror override only the requested interval without mutating recorded data', () => {
  const source: WebcamStyle = { ...webcam, enabled: false, keyframes: [{ t: 0, x: 0.8, y: 0.8,
    size: 0.22, shape: 'circle', mirror: true, visible: false }] };
  const snapshot = structuredClone(source);
  const local = compositionCameraStyle(webcamStyleAt(source, 2), { visible: true, shape: 'rounded', mirror: false, size: 0.7 }, 1280, 720);
  assert.equal(local.enabled, true);
  assert.equal(local.shape, 'rounded'); assert.equal(local.mirror, false);
  assert.deepEqual(source, snapshot);
});

function canvasSpy() {
  const calls: { method: string; args: unknown[] }[] = [];
  let depth = 0;
  const context = new Proxy({}, {
    get(_target, property) {
      return (...args: unknown[]) => {
        const method = String(property); calls.push({ method, args });
        if (method === 'save') depth++;
        if (method === 'restore') depth--;
        if (method === 'createLinearGradient') return { addColorStop: (...values: unknown[]) => calls.push({ method: 'colorStop', args: values }) };
      };
    },
    set() { return true; },
  }) as CanvasRenderingContext2D;
  return { context, calls, depth: () => depth };
}
const screen = { width: 1280, height: 720, name: 'screen' } as unknown as CanvasImageSource;
const face = { width: 640, height: 480, name: 'face' } as unknown as CanvasImageSource;
const replacement = { width: 1000, height: 400, name: 'background' } as unknown as CanvasImageSource;

test('legacy rendering is identical with absent or empty local composition metadata', () => {
  const input = project(), first = canvasSpy(), second = canvasSpy();
  renderFrame(first.context, screen, input, 3, 1280, 720, face);
  renderFrame(second.context, screen, { ...input, compositions: [] }, 3, 1280, 720, face);
  assert.deepEqual(second.calls, first.calls);
  assert.equal(first.depth(), 0);
});

test('hiding or replacing the desktop suppresses both raw screen pixels and cursor effects', () => {
  for (const mode of ['hidden', 'background'] as const) for (const camera of [face, undefined]) {
    const input = project(); input.compositions = [{ ...segment(), screen: mode, background: 'mint' }];
    input.cursor = [{ t: 3, x: 0.5, y: 0.5, visible: true, click: true }];
    const spy = canvasSpy();
    renderFrame(spy.context, screen, input, 3, 1280, 720, camera);
    assert.equal(spy.calls.some((call) => call.method === 'drawImage' && call.args[0] === screen), false);
    assert.equal(spy.calls.some((call) => call.method === 'arc'), false);
    assert.equal(spy.calls.some((call) => call.method === 'drawImage' && call.args[0] === face), !!camera);
    assert.equal(spy.depth(), 0);
  }
});

test('a local medium camera overrides presenter mode only within its half-open interval', () => {
  const input = project(); input.camera!.mode = 'presenter'; input.compositions = [segment()];
  const before = canvasSpy(), during = canvasSpy(), after = canvasSpy();
  renderFrame(before.context, screen, input, 1.99, 1280, 720, face);
  renderFrame(during.context, screen, input, 3, 1280, 720, face);
  renderFrame(after.context, screen, input, 4, 1280, 720, face);
  assert.equal(before.calls.some((call) => call.method === 'drawImage' && call.args[0] === screen), false);
  assert.equal(during.calls.some((call) => call.method === 'drawImage' && call.args[0] === screen), true);
  assert.equal(after.calls.some((call) => call.method === 'drawImage' && call.args[0] === screen), false);
  const translated = during.calls.find((call) => call.method === 'translate')!.args as number[];
  assert.notDeepEqual(translated, [640, 360], 'Local placement must not become a forced full-screen presenter');
});

test('project-owned background images cover the canvas, and missing images never reveal the desktop', () => {
  const input = project(); input.compositions = [{ ...segment(), screen: 'background', background: 'asset:fixture' }];
  for (const image of [replacement, undefined]) {
    const spy = canvasSpy();
    renderFrame(spy.context, screen, input, 3, 1280, 720, undefined, 'source', image);
    const draws = spy.calls.filter((call) => call.method === 'drawImage');
    assert.equal(draws.some((call) => call.args[0] === screen), false);
    assert.equal(draws.some((call) => call.args[0] === replacement), !!image);
    if (image) assert.deepEqual(draws[0].args.slice(1), [-260, 0, 1800, 720]);
  }
});

test('canvas images cover without stretching, remain behind the recording, and respect local overrides', () => {
  const input = project(); input.style.background = 'asset:canvas';
  const spy = canvasSpy();
  renderFrame(spy.context, screen, input, 0, 1280, 720, undefined, 'source', replacement);
  const draws = spy.calls.filter(call => call.method === 'drawImage');
  assert.deepEqual(draws[0].args, [replacement, -260, 0, 1800, 720]);
  assert.ok(draws.some(call => call.args[0] === screen));
  const missing = canvasSpy();
  renderFrame(missing.context, screen, input, 0, 1280, 720);
  assert.equal(missing.calls.some(call => call.method === 'createLinearGradient'), false);
  input.compositions = [{ ...segment(), screen: 'background', background: 'mint' }];
  const override = canvasSpy();
  renderFrame(override.context, screen, input, 3, 1280, 720, undefined, 'source', replacement);
  assert.equal(override.calls.some(call => call.method === 'drawImage' && call.args[0] === replacement), false);
  assert.ok(override.calls.some(call => call.method === 'createLinearGradient'));
});

test('local camera visibility can show a recorded-hidden camera without changing later visibility', () => {
  const input = project(); input.camera!.enabled = false; input.compositions = [segment()];
  const during = canvasSpy(), after = canvasSpy();
  renderFrame(during.context, screen, input, 3, 1280, 720, face);
  renderFrame(after.context, screen, input, 4, 1280, 720, face);
  assert.equal(during.calls.some((call) => call.method === 'drawImage' && call.args[0] === face), true);
  assert.equal(after.calls.some((call) => call.method === 'drawImage' && call.args[0] === face), false);
  assert.equal(input.camera!.enabled, false);
});
