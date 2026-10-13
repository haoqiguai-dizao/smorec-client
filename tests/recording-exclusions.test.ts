import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import type { RecordingController } from '../electron/services/recording';
import type { NativeClient } from '../electron/services/native-client';
import type { ProjectStore } from '../electron/services/projects';
import type { CameraManager } from '../electron/services/camera';
import type { Project } from '../shared/types';

async function controllerFixture(platform: 'win32' | 'darwin') {
  const bundled = await build({ entryPoints: [path.resolve('electron/services/recording.ts')], bundle: true,
    define: { 'process.platform': JSON.stringify(platform) },
    write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'exclusion-service-stubs', setup(builder) {
        builder.onResolve({ filter: /^(electron|\.\/diagnostics)$/ }, args => ({ path: args.path, namespace: 'exclusions' }));
        builder.onLoad({ filter: /.*/, namespace: 'exclusions' }, args => ({ loader: 'js', contents: args.path === 'electron'
          ? 'export const app = {}; export const desktopCapturer = { getSources: async () => [] };'
          : 'export const diagnostic = () => {};',
        }));
      },
    }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const Controller = (module.exports as { RecordingController: typeof RecordingController }).RecordingController;
  const calls: { command: string; options?: Record<string, unknown> }[] = [];
  let rejectUpdate = false, waitUpdate: Promise<void> | undefined;
  let savedOptions: unknown;
  const native = {
    request: async (command: string, options?: Record<string, unknown>) => {
      calls.push({ command, options });
      if (command === 'sources') return [{ id: 'screen:fixture', kind: 'screen', name: '公开测试', width: 1280, height: 720 }];
      if (['start', 'prepare-recording', 'begin-recording'].includes(command)) return { startedAtUnixMs: Date.now() };
      if (command === 'recording-exclusions') { await waitUpdate; if (rejectUpdate) throw new Error('底层更新失败'); return { applied: true }; }
      if (command === 'stop') return { duration: 3, width: 1280, height: 720, directory: 'isolated-exclusion-fixture', video: 'screen.mp4', cursor: 'cursor.json' };
      throw new Error('Unexpected operation: ' + command);
    }, isRunning: () => true, shutdownGracefully: async () => {}, dispose: () => {},
  } as unknown as NativeClient;
  const projects = { createDirectory: async () => ({ id: 'public-fixture', directory: 'isolated-exclusion-fixture' }),
    beginWrite: () => {}, endWrite: () => {},
    acceptRecording: async (_result: unknown, options: unknown) => { savedOptions = options; return { id: 'public-fixture', media: {} } as Project; },
  } as unknown as ProjectStore;
  const controller = new Controller(native, projects, {} as CameraManager);
  return { controller, calls, saved: () => savedOptions as { excludedApplications: string[] },
    reject: (value: boolean) => { rejectUpdate = value; }, wait: (value: Promise<void>) => { waitUpdate = value; } };
}

for (const platform of ['win32', 'darwin'] as const) {
  const application = platform === 'darwin' ? 'studio.fixtures.presenter' : 'C:\\Fixtures\\Presenter.exe';
  test(`${platform}: recording application changes keep one encoder and preserve the last successful selection`, async () => {
    const fixture = await controllerFixture(platform);
    try {
      await assert.rejects(fixture.controller.setExcludedApplications([application]), /正在录制/);
      await fixture.controller.start({ sourceId: 'screen:fixture', fps: 30, systemAudio: true, microphone: false, excludedApplications: [] });
      await fixture.controller.setExcludedApplications([application]);
      await fixture.controller.setExcludedApplications([]);
      await fixture.controller.setExcludedApplications([application]);
      fixture.reject(true);
      await assert.rejects(fixture.controller.setExcludedApplications([]), /底层更新失败/);
      const before = fixture.calls.length;
      await assert.rejects(fixture.controller.setExcludedApplications(['invalid.exe']));
      assert.equal(fixture.calls.length, before, 'Bad renderer input must not reach native capture');
      assert.equal(fixture.calls.filter(item => item.command === 'start').length, 1);
      assert.equal(fixture.calls.filter(item => item.command === 'stop').length, 0);
      await fixture.controller.stop();
      assert.deepEqual(fixture.saved().excludedApplications, [application]);
      assert.equal(fixture.calls.filter(item => item.command === 'stop').length, 1);
    } finally { fixture.controller.dispose(); }
  });

  test(`${platform}: a late exclusion response cannot write selection into an ended recording`, async () => {
    const fixture = await controllerFixture(platform);
    let release!: () => void;
    try {
      await fixture.controller.start({ sourceId: 'screen:fixture', fps: 30, systemAudio: false, microphone: false, excludedApplications: [] });
      fixture.wait(new Promise<void>(resolve => { release = resolve; }));
      const updating = fixture.controller.setExcludedApplications([application]);
      const rejected = assert.rejects(updating, /录制已结束/);
      await fixture.controller.stop(); release();
      await rejected;
      assert.deepEqual(fixture.saved().excludedApplications, []);
    } finally { release?.(); fixture.controller.dispose(); }
  });
}
