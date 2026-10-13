import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { readDemoRanges } from '../electron/services/demo/journal';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import type { RecordingController } from '../electron/services/recording';
import type { NativeClient } from '../electron/services/native-client';
import type { ProjectStore } from '../electron/services/projects';
import type { CameraManager } from '../electron/services/camera';
import type { RecordingState } from '../shared/types';

async function mockedController(): Promise<typeof RecordingController> {
  const bundled = await build({ entryPoints: [path.resolve('electron/services/recording.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'recording-failure-stubs', setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'recording-test' }));
        builder.onResolve({ filter: /^\.\/diagnostics$/ }, () => ({ path: 'diagnostics', namespace: 'recording-test' }));
        builder.onLoad({ filter: /.*/, namespace: 'recording-test' }, args => ({ loader: 'js', contents: args.path === 'electron'
          ? 'export const app = {}; export const desktopCapturer = { getSources: async () => [] };'
          : 'export const diagnostic = () => {};',
        }));
      },
    }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return (module.exports as { RecordingController: typeof RecordingController }).RecordingController;
}

test('stop during late camera preparation cancels only that attachment and saves the continuous screen recording', async () => {
  const Controller = await mockedController(), directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-late-camera-'));
  const calls: string[] = []; let ready!: () => void, entered!: () => void;
  const starting = new Promise<void>(resolve => { entered = resolve; });
  const native = { isRunning: () => true, dispose() {}, shutdownGracefully: async () => {}, request: async (command: string) => {
    if (command === 'sources') return [{ id: 'screen:1', kind: 'screen', name: 'Synthetic', width: 1280, height: 720 }];
    if (command === 'stop') { calls.push('screen-stop'); return { directory, duration: 10, width: 1280, height: 720, video: 'screen.mp4', cursor: 'cursor.json' }; }
    return { startedAtUnixMs: Date.now() - 10000 };
  } } as unknown as NativeClient;
  const projects = { createDirectory: async () => ({ id: 'test', directory }), acceptRecording: async () => ({ id: 'saved-screen', duration: 10, media: { screen: 'screen.mp4' } }),
    endWrite() {}, recover: async () => undefined } as unknown as ProjectStore;
  const camera = { isPrepared: () => true, start: async () => { entered(); await new Promise<void>(resolve => { ready = resolve; }); },
    cancel: async () => { calls.push('camera-cancel'); } } as unknown as CameraManager;
  const controller = new Controller(native, projects, camera);
  try {
    await controller.start({ sourceId: 'screen:1', fps: 30, microphone: false, systemAudio: false });
    const attachment = assert.rejects(controller.attachCamera('prepared-camera'), /录制已结束/); await starting;
    const saved = controller.stop();
    assert.equal(controller.state.status, 'stopping'); assert.deepEqual(calls, []);
    ready(); await attachment; assert.equal((await saved).id, 'saved-screen');
    assert.deepEqual(calls, ['camera-cancel', 'screen-stop']); assert.equal(controller.state.status, 'idle');
  } finally { controller.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
});

test('failed microphone startup publishes a final inactive state after camera and native cleanup', async () => {
  const Controller = await mockedController();
  const calls: string[] = [];
  let rejectStart!: (error: Error) => void, notifyStart!: () => void;
  const enteredStart = new Promise<void>(resolve => { notifyStart = resolve; });
  const native = {
    request: async (command: string) => {
      if (command === 'sources') return [{ id: 'screen:1', kind: 'screen', name: 'Synthetic', width: 1280, height: 720 }];
      if (command === 'microphone-devices') return [{ id: 'selected-microphone', name: 'Selected microphone', isDefault: true }];
      assert.equal(command, process.platform === 'darwin' ? 'prepare-recording' : 'start'); calls.push('native-start'); notifyStart();
      return new Promise((_resolve, reject) => { rejectStart = reject; });
    },
    shutdownGracefully: async () => { calls.push('native-cleanup'); },
  } as unknown as NativeClient;
  const projects = {
    createDirectory: async () => ({ id: 'test-project', directory: 'mock-project-directory' }),
    endWrite: () => { calls.push('project-unlocked'); },
  } as unknown as ProjectStore;
  const camera = {
    start: async () => { calls.push('camera-start'); },
    cancel: async () => { calls.push('camera-cleanup'); },
  } as unknown as CameraManager;
  const controller = new Controller(native, projects, camera);
  const cameraId = '0c64a0bb-c503-4270-bc8d-596fc8fe7459';
  controller.controls.preparePreview(cameraId);
  controller.controls.previewCountdown(cameraId, 1);
  const observed: { status: RecordingState['status']; active: boolean; error?: string }[] = [];
  controller.onState = state => observed.push({ status: state.status, active: controller.isActive(), error: state.error });
  const failure = new Error('所选麦克风没有传入音频');
  const rejected = assert.rejects(controller.start({ sourceId: 'screen:1', fps: 30, systemAudio: false, microphone: true,
    microphoneDeviceId: 'selected-microphone', cameraSessionId: '0c64a0bb-c503-4270-bc8d-596fc8fe7459' }), failure);
  await enteredStart;
  assert.equal(controller.isActive(), true);
  assert.equal(controller.controls.snapshot().countdown, undefined);
  rejectStart(failure); await rejected;
  assert.deepEqual(calls, ['native-start', 'camera-cleanup', 'native-cleanup', 'project-unlocked']);
  assert.deepEqual(observed.at(-1), { status: 'error', active: false, error: failure.message });
  assert.equal(controller.isActive(), false);
  assert.equal(controller.controls.snapshot().countdown, undefined);
});


test('camera data recovery clears its temporary wait while retaining other recording warnings', async () => {
  const Controller = await mockedController();
  const { CAMERA_DATA_WAITING } = await import('../electron/services/camera-health');
  const native = {
    request: async (command: string) => command === 'sources'
      ? [{ id: 'screen:1', kind: 'screen', name: 'Synthetic', width: 1280, height: 720 }]
      : { startedAtUnixMs: Date.now(), warnings: ['另一条录制警告'] },
    dispose() {},
  } as unknown as NativeClient;
  const projects = { createDirectory: async () => ({ id: 'test', directory: 'mock-directory' }) } as unknown as ProjectStore;
  const camera = { start: async () => {} } as unknown as CameraManager;
  const controller = new Controller(native, projects, camera);
  const id = '0c64a0bb-c503-4270-bc8d-596fc8fe7459';
  try {
    await controller.start({ sourceId: 'screen:1', fps: 30, systemAudio: false, microphone: false, cameraSessionId: id });
    camera.onWarning?.(id, CAMERA_DATA_WAITING);
    assert.deepEqual(controller.state.warnings, ['另一条录制警告', CAMERA_DATA_WAITING]);
    camera.onRecovered?.('old-session');
    assert.equal(controller.state.warnings?.includes(CAMERA_DATA_WAITING), true);
    camera.onRecovered?.(id);
    assert.deepEqual(controller.state.warnings, ['另一条录制警告']);
  } finally { controller.dispose(); }
});

test('a stalled camera frame clock reaches the recording warnings and clears once frames resume', async () => {
  const Controller = await mockedController();
  const { cameraFramesStalled } = await import('../electron/services/camera-health');
  const native = {
    request: async (command: string) => command === 'sources'
      ? [{ id: 'screen:1', kind: 'screen', name: 'Synthetic', width: 1280, height: 720 }]
      : { startedAtUnixMs: Date.now(), warnings: ['另一条录制警告'] },
    dispose() {},
  } as unknown as NativeClient;
  const projects = { createDirectory: async () => ({ id: 'test', directory: 'mock-directory' }) } as unknown as ProjectStore;
  const camera = { start: async () => {} } as unknown as CameraManager;
  const controller = new Controller(native, projects, camera);
  const id = '0c64a0bb-c503-4270-bc8d-596fc8fe7459';
  const stall = cameraFramesStalled(7.64);
  try {
    await controller.start({ sourceId: 'screen:1', fps: 30, systemAudio: false, microphone: false, cameraSessionId: id });
    camera.onWarning?.(id, stall);
    assert.deepEqual(controller.state.warnings, ['另一条录制警告', stall]);
    // A stall notice belongs to one camera session and must survive an unrelated session recovering.
    camera.onRecovered?.('old-session');
    assert.equal(controller.state.warnings?.includes(stall), true);
    // Recovery clears only the transient notice; a real fault is never dropped.
    camera.onRecovered?.(id);
    assert.deepEqual(controller.state.warnings, ['另一条录制警告']);
  } finally { controller.dispose(); }
});


test('demo capture begins in an empty native directory and persists visibility on the media clock', async context => {
  const Controller = await mockedController();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-demo-start-'));
  let now = 1000;
  context.mock.method(Date, 'now', () => now);
  const native = {
    request: async (command: string) => {
      if (command === 'sources') return [{ id: 'screen:1', kind: 'screen', name: 'Synthetic', width: 1280, height: 720 }];
      if (command === 'recording-demo') return { time: .4 };
      assert.equal(command, 'start');
      assert.deepEqual(await fs.readdir(directory), [], 'Windows capture refuses any pre-existing recording file');
      await fs.writeFile(path.join(directory, 'screen.mp4'), 'native-started');
      return { startedAtUnixMs: 1000 };
    },
    shutdownGracefully: async () => {}, dispose() {},
  } as unknown as NativeClient;
  const projects = { createDirectory: async () => ({ id: 'demo', directory }), endWrite() {} } as unknown as ProjectStore;
  const controller = new Controller(native, projects, {} as CameraManager);
  controller.demoOptions = () => ({ captureOwnApp: true, ownAppVisible: true });
  try {
    await controller.start({ sourceId: 'screen:1', fps: 30, systemAudio: false, microphone: false });
    assert.equal(controller.state.status, 'recording');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'demo-capture.json'), 'utf8')), [{ t: 0, visible: true }]);
    now = 1400;
    await controller.setDemoVisibility(false);
    assert.deepEqual(await readDemoRanges(directory, .8), [{ start: 0, end: .4 }]);
  } finally {
    controller.dispose();
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});

test('failed native demo startup leaves no display journal and releases the recording session', async () => {
  const Controller = await mockedController();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaolu-demo-failure-'));
  let cleaned = 0, unlocked = 0;
  const native = {
    request: async (command: string) => {
      if (command === 'sources') return [{ id: 'screen:1', kind: 'screen', name: 'Synthetic', width: 1280, height: 720 }];
      throw Error('Native encoder unavailable');
    },
    shutdownGracefully: async () => { cleaned++; }, dispose() {},
  } as unknown as NativeClient;
  const projects = { createDirectory: async () => ({ id: 'demo', directory }), endWrite: () => { unlocked++; } } as unknown as ProjectStore;
  const controller = new Controller(native, projects, {} as CameraManager);
  controller.demoOptions = () => ({ captureOwnApp: true, ownAppVisible: true });
  try {
    await assert.rejects(controller.start({ sourceId: 'screen:1', fps: 30, systemAudio: false, microphone: false }), /Native encoder unavailable/);
    assert.deepEqual(await fs.readdir(directory), []);
    assert.equal(controller.isActive(), false);
    assert.equal(cleaned, 1); assert.equal(unlocked, 1);
  } finally {
    controller.dispose();
    const resolved = await fs.realpath(directory);
    assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir()));
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
