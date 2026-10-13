import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WhiteboardJournal, readRecordedBoard } from '../electron/services/whiteboard/journal';
import { parseBoardRecording } from '../shared/whiteboard/validation';
import { boardVideoVisible } from '../shared/whiteboard/video';
import { decodingProject } from './fixtures/export-decoding';
import { renderFrame } from '../src/services/compositor';
import { applyBoardCapturePolicy, hasBoardCapturePolicy, setBoardDemoVisibility } from '../electron/services/whiteboard/capture-policy';

test('Windows canvas capture protection is owned by the board and follows its output mode', () => {
  if (process.platform !== 'win32') return;
  const calls: boolean[] = [], window = { setContentProtection: (value: boolean) => calls.push(value) };
  assert.equal(hasBoardCapturePolicy(window as never), false);
  applyBoardCapturePolicy(window as never, 'canvas');
  assert.equal(hasBoardCapturePolicy(window as never), true);
  applyBoardCapturePolicy(window as never, 'interface'); applyBoardCapturePolicy(window as never, 'canvas');
  assert.deepEqual(calls, [true, false, true]);
});

test('demo restores canvas control capture for existing and newly opened Windows boards, then restores exclusions', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const calls: boolean[] = [], second: boolean[] = [];
  const window = { setContentProtection: (value: boolean) => calls.push(value), isDestroyed: () => false };
  const later = { setContentProtection: (value: boolean) => second.push(value), isDestroyed: () => false };
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    applyBoardCapturePolicy(window as never, 'canvas');
    setBoardDemoVisibility(true, [window as never]);
    applyBoardCapturePolicy(later as never, 'canvas');
    setBoardDemoVisibility(false, [window as never, later as never]);
    assert.deepEqual(calls, [true, false, true]); assert.deepEqual(second, [false, true]);
  } finally {
    setBoardDemoVisibility(false, []); Object.defineProperty(process, 'platform', descriptor);
  }
});

test('canvas exclusion authority survives recovery and never applies retroactively to older recordings', async () => {
  const directory = await fs.mkdtemp(path.resolve('output/whiteboard-output-test-'));
  try {
    const journal = new WhiteboardJournal(); await journal.reset(directory, true);
    assert.deepEqual(await fs.readdir(directory), [], 'Native start still receives an empty directory');
    journal.start(1000);
    await journal.append({ kind: 'text', id: 'text', text: 'CONTENT', color: '#202020', size: 20, x: 10, y: 10 }, 2000);
    await journal.flush();
    assert.equal((await readRecordedBoard(directory, 3))?.separateCanvas, true);
    await fs.unlink(path.join(directory, 'whiteboard-output.json'));
    assert.equal((await readRecordedBoard(directory, 3))?.separateCanvas, undefined);
    await fs.writeFile(path.join(directory, 'whiteboard-output.json'), '{"separateCanvas":"true"}');
    await assert.rejects(readRecordedBoard(directory, 3), /来源/);
    assert.throws(() => parseBoardRecording({ events: [], separateCanvas: false }, 0));
  } finally {
    assert.equal(path.dirname(directory), path.resolve('output'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('legacy separately replayed boards remain compatible; actual demo UI is never covered by another white board', () => {
  const project = decodingProject(); project.demoCapture = [{ start: 0, end: project.duration }];
  project.style.showCursor = false;
  project.whiteboard = { events: [
    { t: 0, action: { kind: 'layout', visible: true, bounds: { x: .1, y: .1, width: .5, height: .5 },
      windowBounds: { x: .1, y: .05, width: .5, height: .6 }, presentation: 'canvas' } },
    { t: 0, action: { kind: 'text', id: 'text', text: 'CONTENT', color: '#202020', size: 20, x: 10, y: 10 } },
    { t: 1, action: { kind: 'layout', visible: true, bounds: { x: .1, y: .1, width: .5, height: .5 },
      windowBounds: { x: .1, y: .05, width: .5, height: .6 }, presentation: 'interface' } },
  ] };
  const text: string[] = [];
  const ctx = new Proxy({}, { set: () => true, get: (_target, key) => key === 'fillText'
    ? (value: string) => text.push(value) : key === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} }) as CanvasRenderingContext2D;
  renderFrame(ctx, {} as CanvasImageSource, project, .5, 1280, 720); assert.deepEqual(text, []);
  assert.equal(boardVideoVisible(project, 1), false);
  project.whiteboard.separateCanvas = true;
  renderFrame(ctx, {} as CanvasImageSource, project, .5, 1280, 720); assert.deepEqual(text, ['CONTENT']);
  assert.equal(boardVideoVisible(project, 1), true);
  project.whiteboard.interfaceCapture = 'screen';
  assert.equal(boardVideoVisible(project, 1), false, 'Mac embedded interface does not request a separate video');
});

test('switching demo off resumes opaque board replay and its interface decoder at the recorded boundary', () => {
  const project = decodingProject(); project.demoCapture = [{ start: 1, end: 3 }];
  project.whiteboard = { video: { offset: 0 }, events: [{ t: 0, action: { kind: 'layout', visible: true,
    presentation: 'interface', bounds: { x: 0, y: 0, width: 1, height: 1 },
    windowBounds: { x: 0, y: 0, width: 1, height: 1 } } }] };
  assert.deepEqual([.999, 1, 2.999, 3, 9].map(time => boardVideoVisible(project, time)), [true, false, false, true, true]);
});
