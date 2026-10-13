import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { Project, StudioApi } from '../shared/types';
import type { exportVideo } from '../src/services/export-video';
import { DEFAULT_STYLE } from '../shared/constants';
import { getExportCanvasSize } from '../shared/canvas';

type Stall = 'flush' | 'append' | 'decode' | 'return' | 'none';
const never = <T>() => new Promise<T>(() => {});
const project = (frames: number): Project => ({ id: 'synthetic-cancel', name: 'Synthetic', createdAt: '',
  duration: frames / 30, width: 16, height: 16, fps: 30,
  clips: [{ id: 'clip', start: 0, end: frames / 30 }], cursor: [], zooms: [], media: { screen: 'synthetic' },
  style: { ...DEFAULT_STYLE, aspect: 'auto' }, audio: { system: 0, microphone: 0 } });

async function fixture(stall: Stall, stuckReturn = true, stuckCancel = false, supported = true, codec = 'vp8') {
  const state = { inputsDisposed: 0, encoderClosed: 0, encoded: 0, flushed: 0, framesClosed: 0,
    iteratorReturns: 0, append: 0, finish: 0, prepared: 0, canceled: [] as string[],
    frameMetadata: [] as VideoFrameBufferInit[], packetIndices: [] as bigint[],
    configurations: [] as VideoEncoderConfig[], sessions: [] as unknown[] };
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const injected = {
    getCanvasSize: getExportCanvasSize,
    dispose: () => { state.inputsDisposed++; },
    prepare: async () => { state.prepared++; },
    iterator: (times: Generator<number>) => ({
      [Symbol.asyncIterator]() { return this; },
      next: async () => {
        if (stall === 'decode') { entered(); return never<IteratorResult<{ canvas: object }>>(); }
        const time = times.next();
        return time.done ? { done: true as const, value: undefined } : { done: false as const, value: { canvas: {} } };
      },
      return: () => {
        state.iteratorReturns++;
        if (stall === 'return') entered();
        return stuckReturn ? never<IteratorResult<{ canvas: object }>>() : Promise.resolve({ done: true as const, value: undefined });
      },
    }),
  };
  const bundled = await build({ entryPoints: ['src/services/export-video.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'stalled-media', setup(builder) {
      builder.onResolve({ filter: /^(mediabunny|\.\/compositor|\.\/webcam-compositor)$/ }, args => ({ path: args.path, namespace: 'stalled-media' }));
      builder.onLoad({ filter: /.*/, namespace: 'stalled-media' }, ({ path }) => ({ contents: path === 'mediabunny' ? `
        export const MP4={},WEBM={}; export class UrlSource {}
        export class Input { disposed=false; async getPrimaryVideoTrack(){ return {
          canDecode:async()=>true,getFirstTimestamp:async()=>0,computeDuration:async()=>1
        }; } dispose(){if(!this.disposed){this.disposed=true;injected.dispose();}} }
        export class CanvasSink { canvasesAtTimestamps(times){return injected.iterator(times);} }
      ` : path === './compositor' ? 'export const getCanvasSize=project=>injected.getCanvasSize(project); export const renderFrame=()=>{};'
        : 'export const disposeWebcamEffects=()=>{}; export const prepareWebcamEffects=()=>injected.prepare();' }));
    } }] });
  class Encoder {
    static async isConfigSupported(config: VideoEncoderConfig) {
      state.configurations.push(config); return { config, supported: supported && (codec === 'hevc' ? config.codec.startsWith('hvc1') : config.codec === 'vp8') };
    }
    state = 'unconfigured';
    encodeQueueSize = 0;
    constructor(private callbacks: { output: (chunk: { byteLength: number; copyTo: (target: Uint8Array) => void }) => void }) {}
    configure() { this.state = 'configured'; }
    encode() { state.encoded++; this.callbacks.output({ byteLength: 1, copyTo: target => { target[0] = 1; } }); }
    flush() {
      state.flushed++;
      if (stall === 'flush' || stall === 'append') entered();
      // Deliberately keep this promise pending even after close().
      return stall === 'flush' ? never<void>() : Promise.resolve();
    }
    close() { this.state = 'closed'; state.encoderClosed++; }
  }
  const rgba = Uint8ClampedArray.from({ length: 16 * 16 * 4 }, (_, index) => index % 4 === 3 ? 255 : index % 251);
  class Frame {
    constructor(source: Uint8ClampedArray, metadata: VideoFrameBufferInit) {
      if (codec === 'hevc') assert.ok(!ArrayBuffer.isView(source), 'Direct HEVC receives the canvas without CPU readback');
      else {
        assert.ok(ArrayBuffer.isView(source), 'The software encoder must receive CPU pixels');
        assert.deepEqual(source, rgba, 'Preserve every channel of the composed frame');
      }
      state.frameMetadata.push(metadata);
    }
    close() { state.framesClosed++; }
  }
  const module = { exports: {} as { exportVideo: typeof exportVideo } };
  new Function('require', 'module', 'exports', 'injected', 'VideoEncoder', 'VideoFrame', 'window', 'document', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, injected, Encoder, Frame, { VideoEncoder: Encoder },
    { createElement: () => ({ getContext: () => ({ getImageData: () => ({ data: rgba }) }) }) });
  const api = { getStatus: async () => ({ platform: codec === 'hevc' ? 'darwin' : 'win32' }), exportStart: async (_project: Project, settings: unknown) => {
    state.sessions.push(settings); return { id: 'only-this-export', path: 'synthetic.mp4' };
  },
    exportAppend: async (_id: string, packet: ArrayBuffer) => {
      state.append++; state.packetIndices.push(new DataView(packet).getBigUint64(4, true));
      if (stall === 'append') await never<void>();
    },
    exportFinish: async () => { state.finish++; return 'synthetic.mp4'; },
    exportCancel: async (id: string) => { state.canceled.push(id); if (stuckCancel) await never<void>(); },
    cancelExportPreparation: async () => {},
  } as unknown as StudioApi;
  return { exportVideo: module.exports.exportVideo, api, state, waiting };
}

test('HEVC exports all frames directly and only flushes at the end', async () => {
  const testCase = await fixture('none', false, false, true, 'hevc');
  await testCase.exportVideo(testCase.api, project(9), () => {}, new AbortController().signal);
  assert.equal(testCase.state.encoded, 9); assert.equal(testCase.state.append, 9);
  assert.equal(testCase.state.flushed, 1); assert.equal(testCase.state.finish, 1);
  assert.equal((testCase.state.sessions[0] as { codec: string }).codec, 'hevc');
});

for (const stall of ['flush', 'append'] as const) test(`HEVC cancellation exits a stalled ${stall}`, { timeout: 3000 }, async () => {
  const testCase = await fixture(stall, false, true, true, 'hevc'), controller = new AbortController();
  const exporting = testCase.exportVideo(testCase.api, project(4), () => {}, controller.signal);
  await testCase.waiting;
  const rejected = assert.rejects(exporting, { name: 'AbortError' });
  controller.abort(); await rejected;
  assert.equal(testCase.state.encoderClosed, 1); assert.equal(testCase.state.finish, 0);
  assert.deepEqual(testCase.state.canceled, ['only-this-export']);
});

for (const [stall, frames] of [['flush', 8], ['flush', 3], ['append', 8], ['decode', 8], ['return', 3]] as const) {
  test(`cancel exits permanently pending ${stall} at ${frames} frames and closes current resources`, { timeout: 3000 }, async () => {
    const testCase = await fixture(stall, !(stall === 'flush' && frames === 3), true), controller = new AbortController();
    const exporting = testCase.exportVideo(testCase.api, project(frames), () => {}, controller.signal);
    await testCase.waiting;
    const rejected = assert.rejects(exporting, { name: 'AbortError' });
    controller.abort();
    await rejected;
    assert.equal(testCase.state.encoderClosed, 1);
    assert.equal(testCase.state.inputsDisposed, 1);
    assert.deepEqual(testCase.state.canceled, ['only-this-export']);
    assert.equal(testCase.state.finish, 0);
    assert.equal(testCase.state.framesClosed, testCase.state.encoded);
    if (stall === 'append') assert.equal(testCase.state.append, 1, 'Queued packets must not run after cancellation');
  });
}

test('normal export still writes every ordered packet and finishes once', { timeout: 3000 }, async () => {
  const testCase = await fixture('none', false), controller = new AbortController();
  const result = await testCase.exportVideo(testCase.api, project(9), () => {}, controller.signal);
  assert.equal(result, 'synthetic.mp4');
  assert.equal(testCase.state.encoded, 9); assert.equal(testCase.state.append, 9);
  assert.equal(testCase.state.flushed, 2); assert.equal(testCase.state.finish, 1);
  assert.equal(testCase.state.encoderClosed, 1); assert.equal(testCase.state.inputsDisposed, 1);
  assert.deepEqual(testCase.state.canceled, []);
  assert.deepEqual(testCase.state.packetIndices, Array.from({ length: 9 }, (_, index) => BigInt(index)));
  assert.deepEqual(testCase.state.frameMetadata, Array.from({ length: 9 }, (_, index) => ({
    format: 'RGBA', codedWidth: 16, codedHeight: 16,
    timestamp: Math.round(index * 1_000_000 / 30), duration: Math.round(1_000_000 / 30),
    colorSpace: { primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'rgb', fullRange: true },
  })));
});

test('4K export uses original dimensions for support, IPC and frames with bounded encoder batches', async () => {
  const testCase = await fixture('none', false), active = { ...project(5), width: 3840, height: 2160, fps: 60 as const };
  active.duration = 5 / 60; active.clips = [{ id: 'clip', start: 0, end: active.duration }];
  await testCase.exportVideo(testCase.api, active, () => {}, new AbortController().signal);
  assert.equal(testCase.state.configurations[0].width, 3840);
  assert.equal(testCase.state.configurations[0].height, 2160);
  assert.deepEqual(testCase.state.sessions, [{ width: 3840, height: 2160, fps: 60, frames: 5 }]);
  assert.equal(testCase.state.flushed, 3, 'Two 4K frames per batch, then one final flush');
  assert.ok(testCase.state.frameMetadata.every(frame => frame.codedWidth === 3840 && frame.codedHeight === 2160));
});

test('unsupported encoder or raster cannot create an export session or silently downscale', async () => {
  const testCase = await fixture('none', false, false, false);
  await assert.rejects(testCase.exportVideo(testCase.api, { ...project(1), width: 3840, height: 2160 },
    () => {}, new AbortController().signal), /3840 × 2160/);
  assert.equal(testCase.state.sessions.length, 0);
  const oversized = await fixture('none', false);
  await assert.rejects(oversized.exportVideo(oversized.api, { ...project(1), width: 8192, height: 8192 },
    () => {}, new AbortController().signal), /超出支持范围/);
  assert.equal(oversized.state.configurations.length, 0); assert.equal(oversized.state.sessions.length, 0);
});

test('export waits for exact camera effects only on visible frames, including a locally enabled camera', async () => {
  for (const enabled of [false, true]) {
    const testCase = await fixture('none', false), active = project(4);
    active.media.camera = 'synthetic-camera';
    active.camera = { enabled, offset: 0, position: 'bottom-right', size: .25, shape: 'rounded', mirror: false, shrinkOnZoom: false };
    active.compositions = [{ id: 'local', start: 1 / 30, end: 3 / 30, screen: 'recording', camera: { visible: !enabled } }];
    await testCase.exportVideo(testCase.api, active, () => {}, new AbortController().signal);
    assert.equal(testCase.state.prepared, 2, 'Hidden frames do no preparation; local visibility still gets exact-frame effects');
    assert.equal(testCase.state.encoded, 4);
    assert.equal(testCase.state.finish, 1);
  }
});
