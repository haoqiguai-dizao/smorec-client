import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import type { RecordingController } from '../electron/services/recording';
import type { NativeClient } from '../electron/services/native-client';
import type { ProjectStore } from '../electron/services/projects';
import type { CameraManager } from '../electron/services/camera';
import type { CameraModeKeyframe, Project } from '../shared/types';

test('one continuous recording passes exact presenter cuts to project persistence without restarting screen, camera or audio', async context => {
  let now = 1000; context.mock.method(Date, 'now', () => now);
  const bundled = await build({ entryPoints: [path.resolve('electron/services/recording.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'camera-mode-recording-stubs', setup(builder) {
        builder.onResolve({ filter: /^(electron|\.\/diagnostics)$/ }, args => ({ path: args.path, namespace: 'mode-recording' }));
        builder.onLoad({ filter: /.*/, namespace: 'mode-recording' }, args => ({ loader: 'js', contents: args.path === 'electron'
          ? 'export const app = {}; export const desktopCapturer = { getSources: async () => [] };'
          : 'export const diagnostic = () => {};',
        }));
      },
    }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const Controller = (module.exports as { RecordingController: typeof RecordingController }).RecordingController;
  const calls: string[] = [], expected: CameraModeKeyframe[] = [
    { t: 0, mode: 'presenter' }, { t: .25, mode: 'overlay' }, { t: .27, mode: 'presenter' },
  ];
  const result = { directory: 'isolated-fixture', duration: 1, width: 1280, height: 720, video: 'screen.mp4',
    cursor: 'cursor.json', systemAudio: 'system.wav', microphone: 'mic.wav' };
  const cameraId = 'a112a9e2-11e8-4b70-9b3c-7bf59d134c86';
  const native = {
    request: async (command: string) => {
      calls.push(command);
      if (command === 'sources') return [{ id: 'screen:fixture', kind: 'screen', name: 'Synthetic', width: 1280, height: 720 }];
      if (command === 'microphone-devices') return [{ id: 'synthetic-mic', name: 'Synthetic mic', isDefault: true }];
      if (['start', 'prepare-recording', 'begin-recording'].includes(command)) return { startedAtUnixMs: 1000 };
      if (command === 'stop') return result;
      throw new Error(`Unexpected native operation: ${command}`);
    },
    isRunning: () => true, dispose: () => {},
  } as unknown as NativeClient;
  const saved = { id: 'fixture-project', duration: 1, media: { screen: 'screen.mp4', camera: 'camera.webm' } } as Project;
  let accepted = 0;
  const projects = {
    createDirectory: async () => ({ id: saved.id, directory: result.directory }),
    acceptRecording: async (...args: Parameters<ProjectStore['acceptRecording']>) => {
      accepted++; assert.equal(args[0], result);
      assert.equal(args[1].microphone, true); assert.equal(args[1].systemAudio, true);
      assert.deepEqual(args[4], { filename: 'camera.webm', offset: 0 });
      assert.deepEqual(args[7], expected);
      assert.deepEqual(args[8], { aspect: '9:16', crop: { x: .25, y: .75 } });
      assert.equal(args[5]?.length, 1, 'Mode cuts and presenter dragging do not add layout keyframes');
      return saved;
    },
  } as unknown as ProjectStore;
  const camera = {
    start: async (id: string) => { assert.equal(id, cameraId); calls.push('camera-start'); },
    stopAndAttach: async (id: string) => { assert.equal(id, cameraId); calls.push('camera-stop'); return { filename: 'camera.webm', offset: 0 }; },
  } as unknown as CameraManager;
  const controller = new Controller(native, projects, camera);
  try {
    controller.controls.preparePreview(cameraId);
    await controller.controls.control({ type: 'camera-presenter', value: { aspect: '9:16', crop: { x: .25, y: .75 } } });
    await controller.controls.control({ type: 'camera-mode', value: 'presenter' });
    await controller.start({ sourceId: 'screen:fixture', fps: 30, systemAudio: true, microphone: true, cameraSessionId: cameraId });
    now = 1250; await controller.controls.control({ type: 'camera-mode', value: 'overlay' });
    now = 1270; await controller.controls.control({ type: 'camera-mode', value: 'presenter' });
    controller.controls.placement({ x: .1, y: .8 });
    now = 2000; assert.equal(await controller.stop(), saved);
    assert.deepEqual(calls, ['sources', 'microphone-devices',
      ...(process.platform === 'darwin' ? ['prepare-recording', 'camera-start', 'begin-recording'] : ['start', 'camera-start']), 'stop', 'camera-stop']);
    assert.equal(accepted, 1); assert.equal(controller.isActive(), false);
  } finally { controller.dispose(); }
});
