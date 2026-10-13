import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { DEFAULT_STYLE } from '../shared/constants';
import { cameraModeAt } from '../shared/camera-modes';
import { parseProject } from '../electron/services/validation';
import { getCanvasSize, renderFrame } from '../src/services/compositor';
import type { CameraModeKeyframe, NativeRecordingResult, Project, RecordingOptions, WebcamStyle } from '../shared/types';
import type { ProjectStore } from '../electron/services/projects';
import type { RecordingController } from '../electron/services/recording';
import type { NativeClient } from '../electron/services/native-client';
import type { CameraManager } from '../electron/services/camera';
import type { DesktopPreferences } from '../electron/services/desktop-preferences';

const id = 'f7a810b0-c63e-49ba-acaa-3e381f22c822';
const modes: CameraModeKeyframe[] = [{ t: 0, mode: 'overlay' }, { t: 2, mode: 'presenter' }, { t: 4, mode: 'overlay' }];
const style: WebcamStyle = { offset: 0, enabled: false, position: 'bottom-right', size: .22,
  mirror: true, shape: 'circle', shrinkOnZoom: false, mode: 'overlay', modeKeyframes: modes, useRecordedMode: true };
const preferences = { style: { ...DEFAULT_STYLE, aspect: '1:1' }, audio: { system: 1, microphone: 1 },
  camera: { x: .85, y: .8, size: .22, shape: 'circle', mirror: true, visible: true },
  cameraMode: 'presenter', cameraShrinkOnZoom: false };
const options: RecordingOptions = { sourceId: 'screen:fixture', fps: 30, systemAudio: false, microphone: false };
function project(camera: WebcamStyle | undefined = style): Project {
  return { id, name: 'Camera failure fixture', createdAt: '2026-09-07T00:00:00Z', duration: 5, width: 1280, height: 720,
    fps: 30, media: { screen: 'screen.mp4' }, ...(camera ? { camera } : {}), cursor: [],
    clips: [{ id: 'clip', start: 0, end: 5 }], zooms: [], style: { ...DEFAULT_STYLE, showCursor: false },
    audio: { system: 1, microphone: 1 } };
}

async function isolatedModule<T>(entry: string): Promise<T> {
  const bundled = await build({ entryPoints: [path.resolve(entry)], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'camera-mode-failure-isolation', setup(builder) {
        builder.onResolve({ filter: /^(electron|node:child_process|\.\/user-preferences|\.\/diagnostics)$/ },
          args => ({ path: args.path, namespace: 'mode-failure' }));
        builder.onLoad({ filter: /.*/, namespace: 'mode-failure' }, args => ({ loader: 'js', contents: args.path === 'electron'
          ? 'const forbidden=()=>{throw Error("Real profile/window access is forbidden")}; export const app={getPath:forbidden,getAppPath:forbidden}; export const dialog={showOpenDialog:forbidden}; export const shell={trashItem:forbidden,showItemInFolder:forbidden}; export const desktopCapturer={getSources:async()=>[]};'
          : args.path === 'node:child_process' ? 'export const spawn=()=>{throw Error("Native process/device access is forbidden")};'
            : args.path === './user-preferences' ? `const data=${JSON.stringify(preferences)};export const userPreferences={read:()=>structuredClone(data),update(){}};`
              : 'export const diagnostic=()=>{};' }));
      },
    }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports as T;
}

async function fixture(run: (Store: typeof ProjectStore, directory: string) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const directory = await fs.mkdtemp(path.join(output, 'camera-mode-failure-'));
  try {
    const { ProjectStore: Store } = await isolatedModule<{ ProjectStore: typeof ProjectStore }>('electron/services/projects.ts');
    await run(Store, directory);
  } finally {
    const resolved = await fs.realpath(directory), relative = path.relative(await fs.realpath(output), resolved);
    assert.ok(relative.startsWith('camera-mode-failure-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

function composition(active: Project, time: number) {
  const draws: CanvasImageSource[] = [], fills: { color: unknown; rect: number[] }[] = [];
  const context = {
    fillStyle: undefined as unknown, save() {}, restore() {}, setTransform() {}, clearRect() {},
    createLinearGradient: () => ({ addColorStop() {} }), beginPath() {}, roundRect() {}, clip() {}, fill() {}, stroke() {},
    fillRect(...rect: number[]) { fills.push({ color: this.fillStyle, rect }); },
    drawImage(source: CanvasImageSource) { draws.push(source); },
  };
  const screen = { width: active.width, height: active.height } as HTMLCanvasElement;
  const size = getCanvasSize(active);
  renderFrame(context as unknown as CanvasRenderingContext2D, screen, active, time, size.width, size.height);
  return { draws, fills, screen, size };
}

test('camera attachment failure preserves presenter metadata through actual accept, save and Store reconstruction', async () => {
  await fixture(async (Store, directory) => {
    const store = new Store({ root: () => directory }), location = await store.createDirectory();
    const original = Buffer.from('Synthetic immutable screen bytes; no camera or audio content');
    await fs.writeFile(path.join(location.directory, 'screen.mp4'), original);
    await fs.writeFile(path.join(location.directory, 'cursor.json'), '[]');
    const inputModes = structuredClone(modes);
    const accepted = await store.acceptRecording({ ...location, duration: 5, width: 1280, height: 720,
      video: 'screen.mp4', cursor: 'cursor.json' }, { ...options, cameraSessionId: location.id },
    location.id, location.directory, undefined, [], [], inputModes);
    assert.equal(accepted.media.camera, undefined); assert.ok(accepted.camera);
    assert.equal(accepted.camera.enabled, false); assert.equal(accepted.camera.offset, 0);
    assert.equal(accepted.camera.mode, 'overlay'); assert.equal(accepted.camera.useRecordedMode, true);
    assert.deepEqual(accepted.camera.modeKeyframes, modes); assert.equal(accepted.style.aspect, '16:9');
    inputModes[1].mode = 'overlay';
    await store.save(accepted);
    const reopenedStore = new Store({ root: () => directory }), reopened = await reopenedStore.load(location.id);
    assert.equal(reopened.media.camera, undefined); assert.deepEqual(reopened.camera!.modeKeyframes, modes);
    assert.equal(reopened.camera!.enabled, false); assert.equal(reopened.camera!.offset, 0);
    for (const [time, presenter] of [[0, false], [1.999, false], [2, true], [3.999, true], [4, false]] as const) {
      const frame = composition(reopened, time);
      assert.deepEqual(frame.draws, presenter ? [] : [frame.screen]);
      if (presenter) assert.deepEqual(frame.fills, [{ color: '#13151a', rect: [0, 0, frame.size.width, frame.size.height] }]);
    }
    await reopenedStore.save(reopened);
    const manifest = JSON.parse(await fs.readFile(path.join(location.directory, 'project.json'), 'utf8')).project as Project;
    assert.equal(manifest.media.camera, undefined); assert.deepEqual(manifest.camera, reopened.camera);
    assert.deepEqual(await fs.readFile(path.join(location.directory, 'screen.mp4')), original);
    assert.equal((await fs.readdir(location.directory)).some(name => name.startsWith('camera.')), false);
  });
});

test('portrait recording persists framing and canvas through save and reopen, including failed camera attachment', async () => {
  await fixture(async (Store, directory) => {
    const store = new Store({ root: () => directory });
    for (const available of [true, false]) {
      const location = await store.createDirectory();
      await fs.writeFile(path.join(location.directory, 'screen.mp4'), 'Synthetic screen');
      await fs.writeFile(path.join(location.directory, 'cursor.json'), '[]');
      if (available) await fs.writeFile(path.join(location.directory, 'camera.webm'), 'Synthetic camera');
      const framing = { aspect: '9:16' as const, crop: { x: .2, y: .75 } };
      const accepted = await store.acceptRecording({ ...location, duration: 5, width: 1920, height: 1080,
        video: 'screen.mp4', cursor: 'cursor.json' }, { ...options, cameraSessionId: location.id }, location.id, location.directory,
      available ? { filename: 'camera.webm', offset: 0 } : undefined, [], [], structuredClone(modes), framing);
      await store.save(accepted);
      const reopened = await new Store({ root: () => directory }).load(location.id);
      assert.equal(reopened.style.aspect, '9:16'); assert.deepEqual(getCanvasSize(reopened), { width: 1080, height: 1920 });
      assert.deepEqual(reopened.camera!.presenterCrop, framing.crop); assert.equal(reopened.camera!.enabled, available);
      assert.equal(cameraModeAt(reopened.camera, 3), 'presenter');
      assert.throws(() => parseProject({ ...reopened, camera: { ...reopened.camera, presenterCrop: { x: 2, y: .5 } } }));
    }
  });
});

test('no-camera and legacy screen recordings cannot inherit presenter solely from user preferences or unrelated mode history', async () => {
  await fixture(async (Store, directory) => {
    const store = new Store({ root: () => directory });
    for (const [requested, timeline] of [[false, []], [false, modes], [true, [{ t: 0, mode: 'overlay' }]]] as const) {
      const location = await store.createDirectory();
      await fs.writeFile(path.join(location.directory, 'screen.mp4'), 'Synthetic screen');
      await fs.writeFile(path.join(location.directory, 'cursor.json'), '[]');
      const accepted = await store.acceptRecording({ ...location, duration: 5, width: 1280, height: 720,
        video: 'screen.mp4', cursor: 'cursor.json' }, { ...options, ...(requested ? { cameraSessionId: location.id } : {}) },
      location.id, location.directory, undefined, [], [], timeline.map(frame => ({ ...frame })));
      assert.equal(accepted.camera, undefined); assert.equal(accepted.media.camera, undefined);
      assert.equal(cameraModeAt(accepted.camera, 3), 'overlay'); assert.equal(accepted.style.aspect, '1:1');
    }
    const legacy = project(); delete legacy.camera;
    assert.equal(parseProject(legacy).camera, undefined);
  });
});

test('assetless camera metadata requires disabled camera plus presenter history and retains strict field validation', () => {
  const plainPresenter: WebcamStyle = { ...style, mode: 'presenter' }; delete plainPresenter.modeKeyframes;
  for (const valid of [style, plainPresenter]) {
    assert.deepEqual(parseProject(project(valid)).camera, valid);
  }
  const invalid = (patch: Record<string, unknown>) => ({ ...project(), camera: { ...style, ...patch } });
  for (const patch of [
    { enabled: true }, { enabled: 'false' }, { mode: 'overlay', modeKeyframes: [] },
    { mode: 'overlay', modeKeyframes: [{ t: 0, mode: 'overlay' }] }, { mode: 'fullscreen' },
    { useRecordedMode: 'true' }, { modeKeyframes: [{ t: 1, mode: 'fullscreen' }] },
    { modeKeyframes: [...modes].reverse() }, { modeKeyframes: null },
  ]) assert.throws(() => parseProject(invalid(patch)));
  for (const t of [-.001, 5.001, Infinity, NaN, '2']) {
    assert.throws(() => parseProject(invalid({ modeKeyframes: [{ t, mode: 'presenter' }] })));
  }
});

test('same-process stop recovery receives every mode event only when camera capture was requested', async t => {
  const { RecordingController: Controller } = await isolatedModule<{ RecordingController: typeof RecordingController }>('electron/services/recording.ts');
  let now = 100000; t.mock.method(Date, 'now', () => now);
  for (const requested of [true, false]) {
    const calls: string[] = [], recoveredArgs: { id: string; frames: CameraModeKeyframe[] }[] = [];
    const native = {
      request: async (command: string) => {
        if (command === 'sources') return [{ id: options.sourceId, kind: 'screen', name: 'Synthetic', width: 1280, height: 720 }];
        if (['start', 'prepare-recording', 'begin-recording'].includes(command)) return { startedAtUnixMs: now };
        assert.equal(command, 'stop'); throw new Error('Synthetic native stop failure');
      },
      isRunning: () => true, shutdownGracefully: async () => { calls.push('native-cleanup'); }, dispose() {},
    } as unknown as NativeClient;
    const recovered = project(), store = {
      createDirectory: async () => ({ id, directory: 'isolated-in-memory-directory' }),
      endWrite: () => { calls.push('unlocked'); },
      recover: async (value: string, frames: CameraModeKeyframe[] = []) => {
        calls.push('recover'); recoveredArgs.push({ id: value, frames: structuredClone(frames) }); return recovered;
      },
      acceptRecording: (_result: NativeRecordingResult) => { assert.fail('Stop failure must use recovery'); },
    } as unknown as ProjectStore;
    const camera = { start: async () => {}, cancel: async () => { calls.push('camera-cleanup'); } } as unknown as CameraManager;
    const prefs = { read: () => ({ ...preferences, cameraMode: requested ? 'overlay' : 'presenter' }), update() {} } as unknown as DesktopPreferences;
    const controller = new Controller(native, store, camera, prefs), delivered: Project[] = [];
    controller.onProject = value => delivered.push(value);
    try {
      await controller.start({ ...options, ...(requested ? { cameraSessionId: id } : {}) });
      if (requested) {
        now += 2000; await controller.controls.control({ type: 'camera-mode', value: 'presenter' });
        now += 7000; await controller.controls.control({ type: 'camera-mode', value: 'overlay' });
      } else assert.deepEqual(controller.controls.modeKeyframes(Infinity), [{ t: 0, mode: 'presenter' }]);
      const expected = requested ? [{ t: 0, mode: 'overlay' }, { t: 2, mode: 'presenter' }, { t: 9, mode: 'overlay' }] : [];
      assert.equal(await controller.stop(), recovered);
      assert.deepEqual(recoveredArgs, [{ id, frames: expected }], 'The Store must receive untrimmed history before its recovered duration is known');
      assert.deepEqual(calls, [...(requested ? ['camera-cleanup'] : []), 'native-cleanup', 'unlocked', 'recover']);
      assert.deepEqual(delivered, [recovered]); assert.equal(controller.isActive(), false);
    } finally { controller.dispose(); }
  }
});
