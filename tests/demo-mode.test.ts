import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DemoController } from '../electron/services/demo/controller';
import { DemoJournal, readDemoRanges } from '../electron/services/demo/journal';
import { demoCapturedAt, parseDemoRanges } from '../shared/demo';
import { frameContentAt } from '../shared/frame-content';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project } from '../shared/types';
import { renderFrame } from '../src/services/compositor';

function fixture(apply: (visible: boolean) => Promise<void> = async () => {}) {
  const windows: boolean[] = [];
  let restores = 0;
  const controller = new DemoController({ apply, windows: hidden => windows.push(hidden),
    restore: () => { restores++; }, changed: () => {} });
  return { controller, windows, restores: () => restores };
}
test('demo switches retain the capture and desktop controls; stopping restores ordinary mode', async () => {
  const changes: boolean[] = [], { controller, windows, restores } = fixture(async value => { changes.push(value); });
  controller.configure(true); controller.begin('screen:1'); controller.started();
  await controller.toggle(); assert.equal(controller.state.visible, false);
  assert.equal(controller.state.active, true); assert.deepEqual(windows, []);
  await controller.toggle(); await controller.toggleDesktop();
  assert.equal(controller.state.visible, false); assert.equal(controller.state.desktopHidden, true);
  await assert.rejects(controller.toggle(), /恢复桌面/);
  await controller.toggleDesktop(); assert.equal(controller.state.visible, true);
  assert.deepEqual(windows, [true, false]); assert.deepEqual(changes, [false, true, false, true]);
  controller.end(); assert.equal(restores(), 1);
  assert.equal(controller.state.enabled, false); assert.equal(controller.state.active, false);
});
test('capture errors do not falsely acknowledge a switch; stale replies cannot revive ended sessions', async () => {
  const rejected = fixture(async () => { throw Error('filter rejected'); }).controller;
  rejected.configure(true); rejected.begin('screen:1'); rejected.started();
  await assert.rejects(rejected.toggle(), /filter rejected/);
  assert.equal(rejected.state.visible, true); assert.equal(rejected.state.busy, false);
  let finish!: () => void;
  const stale = fixture(() => new Promise(resolve => { finish = resolve; })).controller;
  stale.configure(true); stale.begin('screen:1'); stale.started();
  const pending = stale.toggle(); await assert.rejects(stale.toggle(), /切换/);
  stale.end(); finish(); await pending;
  assert.equal(stale.state.enabled, false); assert.equal(stale.state.visible, false);
  assert.equal(stale.state.busy, false);
});
test('all-interface demo rejects a single-window source before changing the active session', () => {
  const { controller } = fixture(); controller.configure(true);
  assert.throws(() => controller.begin('window:1'), /屏幕或区域/);
  assert.equal(controller.state.active, false);
  controller.configure(false); controller.begin('window:1'); controller.started();
  assert.throws(() => controller.configure(true), /采集开始前/);
});
test('persisted display ranges survive reopening and recovery, use half-open boundaries and clip to media duration', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-demo-test-'));
  try {
    const journal = new DemoJournal(); await journal.start(directory, true);
    await journal.set(2, false); await journal.set(3, true); await journal.set(8, false);
    const ranges = await readDemoRanges(directory, 5);
    assert.deepEqual(ranges, [{ start: 0, end: 2 }, { start: 3, end: 5 }]);
    assert.equal(demoCapturedAt(ranges, 1.99), true); assert.equal(demoCapturedAt(ranges, 2), false);
    assert.equal(demoCapturedAt(ranges, 3), true); assert.equal(demoCapturedAt(ranges, 5), false);
    assert.throws(() => parseDemoRanges([{ start: 0, end: 3 }, { start: 2, end: 4 }], 5));
    assert.throws(() => parseDemoRanges([{ start: 0, end: Infinity }], 5));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('the preview/export compositor renders captured app interfaces once, then resumes camera/board layers', () => {
  const project: Project = { id: 'demo', name: 'demo', createdAt: '2026-10-03T00:00:00Z', duration: 5,
    width: 1280, height: 720, fps: 30, media: { screen: '' }, cursor: [], clips: [], zooms: [],
    demoCapture: [{ start: 0, end: 2 }], style: { ...DEFAULT_STYLE, showCursor: false }, audio: { system: 0, microphone: 0 },
    camera: { offset: 0, enabled: true, mode: 'presenter', size: .22, position: 'bottom-right', mirror: false, shape: 'circle', shrinkOnZoom: false } };
  assert.equal(frameContentAt(project, 1).camera, false);
  assert.equal(frameContentAt(project, 1).presenter, false);
  assert.equal(frameContentAt(project, 2).presenter, true);
  const draws: unknown[] = [], screen = { width: 1280, height: 720 } as HTMLCanvasElement;
  const context = { save() {}, restore() {}, setTransform() {}, clearRect() {}, beginPath() {}, roundRect() {}, clip() {},
    stroke() {}, fill() {}, fillRect() {}, createLinearGradient: () => ({ addColorStop() {} }),
    drawImage(value: unknown) { draws.push(value); } } as unknown as CanvasRenderingContext2D;
  renderFrame(context, screen, project, 1, 1280, 720, { width: 1280, height: 720 } as HTMLCanvasElement);
  assert.deepEqual(draws, [screen]);
});
