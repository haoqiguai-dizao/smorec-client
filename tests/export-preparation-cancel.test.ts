import assert from 'node:assert/strict';
import test from 'node:test';
import { exportVideo } from '../src/services/export-video';
import { DEFAULT_STYLE } from '../shared/constants';
import type { ExportSession, Project, StudioApi } from '../shared/types';

const project: Project = { id: 'test', name: 'Test', createdAt: '', duration: 1, width: 16, height: 16, fps: 30,
  clips: [{ id: 'clip', start: 0, end: 1 }], cursor: [], zooms: [], media: { screen: 'test' }, style: { ...DEFAULT_STYLE },
  audio: { system: 0, microphone: 0 } };

test('cancel during audio preparation requests backend cancellation and also cancels a late allocated session', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalEncoder = Object.getOwnPropertyDescriptor(globalThis, 'VideoEncoder');
  const Encoder = { isConfigSupported: async () => ({ supported: true }) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { VideoEncoder: Encoder } });
  Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, value: Encoder });
  try {
    for (const session of [null, { id: 'late-session', path: 'output.mp4' }]) {
      let resolveStart!: (value: ExportSession | null) => void, entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const preparation = new Promise<ExportSession | null>(resolve => { resolveStart = resolve; });
      const canceled: string[] = []; let canceledPreparation = 0;
      const api = { getStatus: async () => ({ platform: 'win32' }), exportStart: async () => { entered(); return preparation; },
        cancelExportPreparation: async () => { canceledPreparation++; }, exportCancel: async (id: string) => { canceled.push(id); },
      } as unknown as StudioApi;
      const controller = new AbortController();
      const exporting = exportVideo(api, project, () => {}, controller.signal);
      await started; controller.abort(); resolveStart(session);
      await assert.rejects(exporting, { name: 'AbortError' });
      assert.equal(canceledPreparation, 1);
      assert.deepEqual(canceled, session ? [session.id] : []);
    }
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (originalEncoder) Object.defineProperty(globalThis, 'VideoEncoder', originalEncoder); else Reflect.deleteProperty(globalThis, 'VideoEncoder');
  }
});
