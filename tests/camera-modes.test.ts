import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { cameraModeAt } from '../shared/camera-modes';
import { webcamStyleAt } from '../shared/camera-layout';
import { outputToSourceTime } from '../shared/timeline';
import { DEFAULT_STYLE } from '../shared/constants';
import { parseProject } from '../electron/services/validation';
import type { CameraModeKeyframe, Project, WebcamStyle } from '../shared/types';
import type { ProjectStore } from '../electron/services/projects';

const legacy: WebcamStyle = { offset: .8, enabled: true, position: 'bottom-right', size: .22,
  mirror: true, shape: 'circle', shrinkOnZoom: true, placement: { x: .85, y: .8 } };
const frames: CameraModeKeyframe[] = [{ t: 0, mode: 'overlay' }, { t: 2, mode: 'presenter' }, { t: 4, mode: 'overlay' }];
const camera: WebcamStyle = { ...legacy, mode: 'overlay', modeKeyframes: frames, useRecordedMode: true };
function project(style: WebcamStyle = legacy): Project {
  return { id: '7dc845aa-0f27-4cab-89b9-d780f9b78623', name: 'Presenter fixture', createdAt: '2026-09-07T00:00:00.000Z',
    duration: 5, width: 1280, height: 720, fps: 30, media: { screen: 'screen.mp4', camera: 'camera.webm' }, camera: style,
    cursor: [], clips: [{ id: 'clip', start: 0, end: 5 }], zooms: [], style: { ...DEFAULT_STYLE }, audio: { system: 1, microphone: 1 } };
}

test('legacy project validation stays byte-shape compatible and defaults to overlay without adding mode fields', () => {
  const parsed = parseProject(project());
  assert.deepEqual(parsed.camera, legacy);
  assert.equal(Object.hasOwn(parsed.camera!, 'mode'), false);
  assert.equal(cameraModeAt(parsed.camera, 3), 'overlay');
  assert.equal(cameraModeAt(undefined, 3), 'overlay');
  assert.equal(cameraModeAt({ ...legacy, mode: 'presenter' }, 3), 'presenter');
});

test('mode is a source-time step function through rapid transitions, duplicate times and backward seeks', () => {
  const before = JSON.stringify(camera);
  for (const [time, expected] of [[0, 'overlay'], [1.999999, 'overlay'], [2, 'presenter'], [3.99999, 'presenter'],
    [4, 'overlay'], [5, 'overlay'], [2.01, 'presenter'], [.5, 'overlay']] as const) {
    assert.equal(cameraModeAt(camera, time), expected);
  }
  const rapid: WebcamStyle = { ...legacy, modeKeyframes: [
    { t: 1, mode: 'presenter' }, { t: 1.01, mode: 'overlay' }, { t: 1.02, mode: 'presenter' },
    { t: 1.02, mode: 'overlay' }, { t: 1.03, mode: 'presenter' },
  ] };
  assert.equal(cameraModeAt(rapid, .99), 'overlay', 'Do not anticipate the first transition');
  assert.equal(cameraModeAt(rapid, 1.005), 'presenter');
  assert.equal(cameraModeAt(rapid, 1.015), 'overlay');
  assert.equal(cameraModeAt(rapid, 1.02), 'overlay', 'Last action wins at equal timestamps');
  assert.equal(cameraModeAt(rapid, 1.03), 'presenter');
  assert.equal(JSON.stringify(camera), before);
});

test('cuts reorder source-time modes without applying camera offset to the composition timeline', () => {
  const clips = [{ id: 'presenter', start: 2.5, end: 3.5 }, { id: 'screen', start: 0, end: 2 }];
  for (const offset of [-2, 0, 1.2, 30]) {
    const style = { ...camera, offset };
    assert.equal(cameraModeAt(style, outputToSourceTime(clips, .2)), 'presenter');
    assert.equal(cameraModeAt(style, outputToSourceTime(clips, 1.2)), 'overlay');
  }
});

test('camera disabled or manual geometry cannot erase recorded presenter segments or the restored small layout', () => {
  const edited: WebcamStyle = { ...camera, enabled: false, useRecordedLayout: false, shape: 'rounded', size: .31,
    placement: { x: .25, y: .3 }, keyframes: [{ t: 0, x: .9, y: .9, size: .2, shape: 'circle', visible: false, mirror: false }] };
  assert.equal(cameraModeAt(edited, 3), 'presenter', 'Disabled presenter must remain presenter to prevent screen fallback');
  assert.equal(cameraModeAt(webcamStyleAt(edited, 3), 3), 'presenter');
  const returned = webcamStyleAt({ ...edited, enabled: true }, 4.2);
  assert.equal(cameraModeAt(returned, 4.2), 'overlay');
  assert.equal(returned.shape, 'rounded');
  assert.equal(returned.size, .31);
  assert.deepEqual(returned.placement, { x: .25, y: .3 });
});

test('manual mode overrides preserve the recorded cuts and independent layout/effect settings', () => {
  const manual: WebcamStyle = { ...camera, mode: 'presenter', useRecordedMode: false, useRecordedLayout: true,
    keyframes: [{ t: 0, x: .4, y: .3, size: .3, shape: 'square', mirror: false, visible: true }],
    effects: { enabled: true, smoothing: .2, brightness: .1, filter: 'warm', intensity: .3 } };
  assert.equal(cameraModeAt(manual, 4.5), 'presenter');
  assert.equal(webcamStyleAt(manual, 4.5).shape, 'square');
  assert.deepEqual(webcamStyleAt(manual, 4.5).effects, manual.effects);
  assert.deepEqual(manual.modeKeyframes, frames);
  assert.equal(cameraModeAt({ ...manual, useRecordedMode: true }, 4.5), 'overlay');
});

test('project JSON round trip retains detached mode cuts, source geometry, and explicit aspect', () => {
  const input = project(camera); input.style.aspect = '9:16';
  const result = parseProject(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(result, input);
  result.camera!.modeKeyframes![1].mode = 'overlay';
  assert.equal(input.camera!.modeKeyframes![1].mode, 'presenter', 'Validation cannot alias submitted keyframe objects');
  const reopened = parseProject(JSON.parse(JSON.stringify(input)));
  assert.equal(cameraModeAt(reopened.camera, 2.5), 'presenter');
  assert.equal(reopened.style.aspect, '9:16', 'Mode parsing must respect an explicitly chosen canvas');
  assert.deepEqual(reopened.camera!.placement, legacy.placement);
});

test('project mode validation rejects malformed switches, modes and unordered/out-of-range event times', () => {
  for (const mode of ['fullscreen', '', null, 1, {}, '__proto__']) {
    assert.throws(() => parseProject(project({ ...legacy, mode } as WebcamStyle)));
    assert.throws(() => parseProject(project({ ...legacy, modeKeyframes: [{ t: 1, mode }] } as WebcamStyle)));
  }
  for (const t of [-.001, 5.001, NaN, Infinity, '2', null]) {
    assert.throws(() => parseProject(project({ ...legacy, modeKeyframes: [{ t, mode: 'presenter' }] } as WebcamStyle)));
  }
  for (const value of [null, 1, 'true']) assert.throws(() => parseProject(project({ ...camera, useRecordedMode: value } as unknown as WebcamStyle)));
  for (const value of [null, {}, 'presenter']) assert.throws(() => parseProject(project({ ...camera, modeKeyframes: value } as WebcamStyle)));
  assert.throws(() => parseProject(project({ ...camera, modeKeyframes: [...frames].reverse() })));
  assert.deepEqual(parseProject(project({ ...camera, modeKeyframes: [] })).camera!.modeKeyframes, []);
  assert.equal(cameraModeAt({ ...camera, modeKeyframes: [] }, 3), 'overlay');
});

async function projectStore(withSyntheticProbe = false): Promise<typeof ProjectStore> {
  const bundle = await build({ entryPoints: [path.resolve('electron/services/projects.ts')], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'isolated-presenter-store', setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'presenter-test' }));
        if (withSyntheticProbe) builder.onResolve({ filter: /^\.\/ffmpeg$/ }, () => ({ path: 'ffmpeg', namespace: 'presenter-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'presenter-test' }, args => ({ contents: args.path === 'ffmpeg'
          ? 'export const probeMedia=async()=>({duration:5,width:1280,height:720});export function ffmpegPath(){throw new Error("No media process allowed");}export function normalizeMedia(){throw new Error("No import allowed");}'
          : 'export const app={getPath(){throw new Error("Isolated root required");}};export const dialog={};export const shell={};', loader: 'js' }));
      },
    }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return (module.exports as { ProjectStore: typeof ProjectStore }).ProjectStore;
}

test('accepted presenter recording persists mode cuts across save and restart without changing original media or overlay aspect', async () => {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'camera-modes-metadata-'));
  try {
    const Store = await projectStore();
    const store = new Store(); store.root = () => directory;
    for (const presenter of [false, true]) {
      const recording = await store.createDirectory();
      const mediaBytes = Buffer.from('Synthetic original camera bytes, never capture a device');
      await Promise.all([fs.writeFile(path.join(recording.directory, 'screen.mp4'), 'Synthetic screen'),
        fs.writeFile(path.join(recording.directory, 'camera.webm'), mediaBytes),
        fs.writeFile(path.join(recording.directory, 'cursor.json'), '[]')]);
      const timeline: CameraModeKeyframe[] = presenter ? frames.map(frame => ({ ...frame })) : [{ t: 0, mode: 'overlay' }];
      const accepted = await store.acceptRecording({ directory: recording.directory, duration: 5, width: 1280, height: 720,
        video: 'screen.mp4', cursor: 'cursor.json' }, { sourceId: 'screen:synthetic', cameraSessionId: recording.id,
        fps: 30, systemAudio: false, microphone: false }, recording.id, recording.directory,
      { filename: 'camera.webm', offset: .8 }, [], [], timeline);
      assert.equal(accepted.style.aspect, presenter ? '16:9' : DEFAULT_STYLE.aspect);
      assert.deepEqual(accepted.camera!.modeKeyframes, timeline);
      const expected = timeline.map(frame => ({ ...frame })); timeline[0].mode = 'presenter';
      await store.save({ ...accepted, style: { ...accepted.style, aspect: '1:1' },
        camera: { ...accepted.camera!, useRecordedLayout: false, placement: { x: .3, y: .4 } } });
      const restarted = new Store(); restarted.root = () => directory;
      const reopened = await restarted.load(recording.id);
      assert.equal(reopened.style.aspect, '1:1');
      assert.deepEqual(reopened.camera!.modeKeyframes, expected);
      assert.equal(cameraModeAt(reopened.camera, 3), presenter ? 'presenter' : 'overlay');
      assert.deepEqual(reopened.camera!.placement, { x: .3, y: .4 });
      assert.equal(reopened.camera!.offset, .8);
      assert.deepEqual(await fs.readFile(path.join(recording.directory, 'camera.webm')), mediaBytes);
    }
  } finally {
    const resolved = await fs.realpath(directory);
    assert.ok(resolved.startsWith(path.join(output, 'camera-modes-metadata-')));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('same-process native recovery keeps unavailable presenter cuts and clips events to recovered source duration', async () => {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'camera-modes-recovery-'));
  try {
    // Only the codec probe is substituted; recovery reads real isolated journals and persists a real manifest.
    const Store = await projectStore(true), store = new Store(); store.root = () => directory;
    for (const sourceFrames of [frames, [{ t: 0, mode: 'overlay' }, { t: 6, mode: 'presenter' }] as CameraModeKeyframe[], []]) {
      const recording = await store.createDirectory();
      const screen = Buffer.from('Synthetic retained screen bytes');
      const recovery = JSON.stringify({ createdAt: '2026-09-07T00:00:00Z', options: { fps: 30 } });
      await Promise.all([fs.writeFile(path.join(recording.directory, 'screen.mp4'), screen),
        fs.writeFile(path.join(recording.directory, 'cursor.json'), '[]'),
        fs.writeFile(path.join(recording.directory, 'recording.recovery.json'), recovery)]);
      store.endWrite(recording.id);
      const found = await store.recover(recording.id, sourceFrames);
      assert.ok(found); assert.equal(found.duration, 5); assert.equal(found.media.camera, undefined);
      const includesPresenter = sourceFrames.some(frame => frame.t <= 5 && frame.mode === 'presenter');
      if (includesPresenter) {
        assert.equal(found.camera!.enabled, false); assert.equal(found.camera!.offset, 0);
        assert.deepEqual(found.camera!.modeKeyframes, frames); assert.equal(found.style.aspect, '16:9');
        assert.equal(cameraModeAt(found.camera, 3), 'presenter');
      } else assert.equal(found.camera, undefined, 'An event outside the recovered duration cannot create a presenter segment');
      await store.save(found);
      const restarted = new Store(); restarted.root = () => directory;
      assert.deepEqual((await restarted.load(recording.id)).camera, found.camera);
      assert.deepEqual(await fs.readFile(path.join(recording.directory, 'screen.mp4')), screen);
      assert.equal(await fs.readFile(path.join(recording.directory, 'recording.recovery.json'), 'utf8'), recovery);
    }
  } finally {
    const resolved = await fs.realpath(directory);
    assert.ok(resolved.startsWith(path.join(output, 'camera-modes-recovery-')));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
