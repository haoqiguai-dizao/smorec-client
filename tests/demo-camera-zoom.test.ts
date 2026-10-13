import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Project } from '../shared/types';
import { DEFAULT_STYLE } from '../shared/constants';
import { demoCameraEmbeddedAt, parseDemoRanges } from '../shared/demo';
import { frameContentAt } from '../shared/frame-content';
import { cameraSelectionState } from '../src/services/camera-selection';
import { compositionTransformState } from '../src/services/composition-transform';
import { renderFrame } from '../src/services/compositor';
import { DemoJournal, readDemoRanges } from '../electron/services/demo/journal';
import { DemoController } from '../electron/services/demo/controller';
import { bindCameraCapturePreparation, capturedDemoCamera, prepareIndependentCamera, protectIndependentCamera, isIndependentCameraWindow } from '../electron/services/demo/camera-policy';
import { decodingFixture } from './fixtures/export-decoding';

function fixture(): Project {
  return { id: 'demo-camera', name: '独立人物', createdAt: '', duration: 6, width: 1280, height: 720, fps: 30,
    media: { screen: 'screen.mp4', camera: 'camera.mp4' }, clips: [{ id: 'clip', start: 0, end: 6 }], cursor: [],
    zooms: [{ id: 'zoom', start: 0, end: 6, x: .25, y: .35, scale: 2.5 }],
    style: { ...DEFAULT_STYLE, padding: 0, radius: 0, showCursor: false }, audio: { system: 0, microphone: 0 },
    camera: { offset: 0, enabled: true, position: 'bottom-right', size: .3, shape: 'rounded', mirror: false, shrinkOnZoom: true },
    demoCapture: [{ start: 1, end: 4, camera: 'independent' }] };
}
function paint(input: Project, time = 2, mode: 'preview' | 'source' = 'source') {
  const screen = { width: 1280, height: 720 } as HTMLCanvasElement, person = { width: 320, height: 320 } as HTMLCanvasElement;
  const draws: { source: unknown; args: number[] }[] = [], rectangles: number[][] = [];
  const ctx = new Proxy({}, { get: (_, key) => key === 'drawImage' ? (source: unknown, ...args: number[]) => draws.push({ source, args })
    : key === 'roundRect' ? (...args: number[]) => rectangles.push(args)
      : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} }) as CanvasRenderingContext2D;
  renderFrame(ctx, screen, input, time, 1280, 720, person, mode);
  return { draws, rectangles, screen, person };
}

test('independent demo frames zoom the screen while keeping one complete, selectable person above it', () => {
  const input = fixture();
  for (const mode of ['preview', 'source'] as const) {
    const rendered = paint(input, 2, mode), selection = cameraSelectionState(input, 2)!;
    assert.deepEqual(rendered.draws.map(item => item.source), [rendered.screen, rendered.person]);
    assert.equal(rendered.draws[0].args[2], input.width * 2.5);
    const cameraRect = rendered.rectangles.at(-1)!;
    assert.equal(cameraRect[0], selection.rect.x); assert.equal(cameraRect[1], selection.rect.y);
    assert.equal(cameraRect[2], 720 * .3 * .76);
    assert.ok(cameraRect[0] >= 0 && cameraRect[1] >= 0 && cameraRect[0] + cameraRect[2] <= 1280 && cameraRect[1] + cameraRect[3] <= 720);
  }
  assert.equal(frameContentAt(input, 2).cameraEmbedded, false);
});

test('independent demo camera can be resized, moved and hidden without changing the screen or double-shrinking', () => {
  const input = fixture(), segment = { id: 'local', start: 0, end: 6, screen: 'recording' as const,
    camera: { visible: true, x: .95, y: .95, size: .8 } };
  input.compositions = [segment];
  assert.equal(compositionTransformState(input, segment, 2)?.editable, true);
  const rendered = paint(input), selection = cameraSelectionState(input, 2)!;
  assert.equal(selection.rect.width, 720 * .8);
  assert.equal(selection.rect.x + selection.rect.width, 1280);
  assert.equal(selection.rect.y + selection.rect.height, 720);
  assert.deepEqual(rendered.rectangles.at(-1)!.slice(0, 4), [selection.rect.x, selection.rect.y, selection.rect.width, selection.rect.height]);
  segment.camera.visible = false;
  assert.equal(cameraSelectionState(input, 2), undefined);
  assert.deepEqual(paint(input).draws.map(item => (item.source as HTMLCanvasElement).width), [1280]);
});

test('legacy embedded person locks screen framing even after global camera edits; ordinary and covered intervals still zoom', () => {
  const input = fixture(); delete input.demoCapture![0].camera;
  for (const time of [.999, 1, 3.999, 4]) {
    assert.equal(paint(input, time).draws[0].args[2], input.width * (time >= 1 && time < 4 ? 1 : 2.5));
  }
  input.camera!.enabled = false;
  assert.equal(frameContentAt(input, 2).screenZoomLocked, true);
  assert.equal(paint(input).draws.length, 1);
  input.camera!.enabled = true;
  input.whiteboard = { separateCanvas: true, events: [{ t: 0, action: { kind: 'layout', visible: true,
    bounds: { x: 0, y: 0, width: 1, height: 1 } } }] };
  assert.equal(frameContentAt(input, 2).screenZoomLocked, false);
  assert.equal(paint(input).draws[0].args[2], 1280 * 2.5);
  assert.ok(cameraSelectionState(input, 2));
  input.whiteboard = { separateCanvas: true, interfaceCapture: 'screen', events: [{ t: 0, action: {
    kind: 'layout', visible: true, presentation: 'interface', bounds: { x: 0, y: 0, width: 1, height: 1 },
  } }] };
  assert.equal(frameContentAt(input, 2).screenZoomLocked, true);
});

test('legacy frames without a recorded visible person can zoom, and demo presenter metadata does not make a fullscreen hit target', () => {
  const input = fixture(); delete input.demoCapture![0].camera;
  input.camera!.keyframes = [{ t: 0, visible: false, x: .8, y: .8, size: .3, shape: 'rounded', mirror: false }];
  assert.equal(frameContentAt(input, 2).screenZoomLocked, false);
  input.demoCapture![0].camera = 'independent'; input.camera!.mode = 'presenter'; input.camera!.keyframes[0].visible = true;
  assert.equal(frameContentAt(input, 2).presenter, false);
  assert.ok(cameraSelectionState(input, 2)!.rect.width < 1280);
});

test('recording/recovery preserves mixed camera facts and old journals without guessing independent tracks', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-camera-layer-'));
  try {
    const journal = new DemoJournal(); await journal.start(directory, true);
    await journal.set(1, false); await journal.set(2, true, 'independent'); await journal.set(4, false, 'independent');
    const ranges = await readDemoRanges(directory, 3);
    assert.deepEqual(ranges, [{ start: 0, end: 1 }, { start: 2, end: 3, camera: 'independent' }]);
    assert.deepEqual(parseDemoRanges(ranges, 3), ranges);
    assert.equal(demoCameraEmbeddedAt(ranges, .9), true);
    assert.equal(demoCameraEmbeddedAt(ranges, 1), false);
    assert.equal(demoCameraEmbeddedAt(ranges, 2), false);
    assert.throws(() => parseDemoRanges([{ start: 0, end: 1, camera: true }], 3));
    await fs.writeFile(path.join(directory, 'demo-capture.json'), JSON.stringify([{ t: 0, visible: true, camera: 'guess' }]));
    await assert.rejects(readDemoRanges(directory, 3), /无效/);
    assert.equal(capturedDemoCamera('darwin'), undefined);
    assert.equal(capturedDemoCamera('darwin', true), 'independent');
    assert.equal(capturedDemoCamera('win32'), 'independent');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('local preview locks its native title and Windows protection while ordinary windows remain outside the policy', () => {
  const handlers: Record<string, (event: { preventDefault(): void }) => void> = {};
  let title = '', protectedContent = false, prevented = false;
  const window = { setTitle(value: string) { title = value; }, on(name: string, handler: typeof handlers[string]) { handlers[name] = handler; },
    setContentProtection(value: boolean) { protectedContent = value; } } as BrowserWindow;
  protectIndependentCamera(window, 'win32');
  assert.equal(title, '小录摄像头'); assert.equal(protectedContent, true);
  handlers['page-title-updated']({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(isIndependentCameraWindow(window), true);
  assert.equal(isIndependentCameraWindow({} as BrowserWindow), false);
});

test('export decodes the independent camera through demo intervals as well as ordinary intervals', async () => {
  const input = fixture(), decoded = await decodingFixture();
  for await (const frame of decoded.decodeFrames(input, 12, 2, new AbortController().signal)) assert.ok(frame.webcam);
  assert.deepEqual(decoded.state.requested.filter(item => item.track === 'camera.mp4').map(item => item.time), Array.from({ length: 12 }, (_, i) => i / 2));
});

test('late Mac previews wait for capture exclusion, propagate failure and release their session binding', async () => {
  const window = { setTitle() {}, on() {} } as unknown as BrowserWindow;
  protectIndependentCamera(window, 'darwin');
  let release!: () => void, ready = false;
  const unbind = bindCameraCapturePreparation(() => new Promise<void>(resolve => { release = resolve; }));
  const preparing = prepareIndependentCamera(window, 'darwin').then(() => { ready = true; });
  assert.equal(ready, false); release(); await preparing; assert.equal(ready, true);
  unbind(); await prepareIndependentCamera(window, 'darwin');
  const unbindFailure = bindCameraCapturePreparation(async () => { throw Error('filter failed'); });
  await assert.rejects(prepareIndependentCamera(window, 'darwin'), /filter failed/);
  await prepareIndependentCamera(window, 'win32');
  unbindFailure(); await prepareIndependentCamera(window, 'darwin');
});

test('preview filter refresh uses the same exclusive demo transition and cannot revive a stopped session', async () => {
  let release!: () => void; const applied: boolean[] = [];
  const controller = new DemoController({ windows() {}, restore() {}, changed() {},
    apply: visible => { applied.push(visible); return new Promise<void>(resolve => { release = resolve; }); } });
  controller.configure(true); controller.begin('screen:1'); controller.started();
  const pending = controller.refresh();
  assert.equal(controller.state.busy, true);
  await assert.rejects(controller.toggle(), /切换/);
  await assert.rejects(controller.refresh(), /切换/);
  assert.deepEqual(applied, [true]);
  controller.end(); release(); await pending;
  assert.equal(controller.state.active, false); assert.equal(controller.state.enabled, false); assert.equal(controller.state.busy, false);
});
