import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import type { LiveSession } from '../electron/services/live/session';
import type { LiveAudioState, LiveInput, LiveState } from '../shared/live-types';
import type { LiveRecordingState, RecordingState } from '../shared/types';
import { DEFAULT_STYLE } from '../shared/constants';
import type { StreamConnection, StreamProfile } from '../shared/streaming';
import { DEFAULT_STREAM_ENCODING } from '../shared/streaming';

const bundle = build({ entryPoints: [path.resolve('electron/services/live/session.ts')], bundle: true, write: false,
  platform: 'node', define: { 'process.platform': '"win32"' }, format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'live-session-fixture', setup(builder) {
    builder.onResolve({ filter: /^live-session-context$/ }, args => ({ path: args.path, external: true }));
    builder.onResolve({ filter: /^\.\.\/(native-client|user-preferences|diagnostics)$|^\.\/(frame-client|virtual-camera)$/ },
      args => ({ path: args.path, namespace: 'live-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'live-fixture' }, args => ({ loader: 'js', contents:
      `import context from 'live-session-context'; ` + ({
        '../native-client': 'export const NativeClient=context.Native;',
        '../user-preferences': 'export const userPreferences={read:()=>context.preferences};',
        '../diagnostics': 'export const diagnostic=(scope,error,detail)=>context.diagnostics.push({scope,error:error?.message,detail});',
        './frame-client': 'export const LiveFrameClient=context.Frames;',
        './virtual-camera': 'export const VirtualCameraWriter=context.Writer;export const virtualCameraStatus=async()=>({installed:true});',
      } as Record<string, string>)[args.path],
    }));
  } }] });

export interface LiveFixture {
  session: LiveSession;
  states: LiveState[];
  prepared: number; restored: number; stoppedWriter: number; stoppedNative: number; closedFrames: number;
  idle: boolean; prepareError?: Error; restoreError?: Error; writerStopError?: Error; pullError?: Error; writeError?: Error;
  prepareHook?: () => Promise<void>;
  nativeHook?: (native: FixtureNative) => Promise<{ width: number; height: number }>;
  writerHook?: (failed: (error: Error) => void) => Promise<void>;
  native?: FixtureNative;
  exclusionUpdates: unknown[]; exclusionHook?: () => Promise<void>;
  audioUpdates: unknown[]; audioHook?: () => Promise<void>;
  demoUpdates: unknown[];
  demo?: { captureOwnApp: boolean; ownAppVisible: boolean };
  pullHook?: () => Promise<number>;
  deviceInstalled?: boolean; streamProfileError?: Error; nativeOptions?: Record<string, unknown>;
  streamChanged?: (state: StreamConnection) => void; streamFailed?: (error: Error) => void;
  streamWrites: { time?: number; pixels: unknown }[]; streamAudio: { time: number; data: Buffer }[];
  diagnostics: { scope: string; error?: string; detail?: Record<string, unknown> }[];
}
interface FixtureNative {
  onLiveInput?: (events: LiveInput[]) => void;
  onLiveError?: (error: string) => void;
  onState?: (state: RecordingState) => void;
}

export async function liveFixture(): Promise<LiveFixture> {
  const fixture: LiveFixture = { session: undefined as unknown as LiveSession, states: [], prepared: 0, restored: 0,
    stoppedWriter: 0, stoppedNative: 0, closedFrames: 0, idle: true, exclusionUpdates: [], audioUpdates: [], demoUpdates: [], streamWrites: [], streamAudio: [], diagnostics: [] };
  class Native implements FixtureNative {
    onLiveInput?: (events: LiveInput[]) => void;
    onLiveError?: (error: string) => void;
    onState?: (state: RecordingState) => void;
    private abort?: (error: Error) => void;
    constructor() { fixture.native = this; }
    async request(command: string, extra: Record<string, unknown>): Promise<unknown> {
      if (command === 'live-start') fixture.nativeOptions = extra.options as Record<string, unknown>;
      if (command === 'live-exclusions') { fixture.exclusionUpdates.push(extra); await fixture.exclusionHook?.(); return { applied: true }; }
      if (command === 'live-audio') { fixture.audioUpdates.push(extra); await fixture.audioHook?.(); return extra.options as LiveAudioState; }
      if (command === 'live-demo') { fixture.demoUpdates.push(extra); return { applied: true }; }
      const closed = new Promise<never>((_, reject) => { this.abort = reject; });
      const work = fixture.nativeHook?.(this) ?? Promise.resolve({ width: 640, height: 360 });
      return Promise.race([work, closed]);
    }
    dispose(): void { this.abort?.(new Error('Synthetic native disposed')); }
    async shutdownGracefully(): Promise<void> { fixture.stoppedNative++; this.dispose(); }
  }
  class Frames {
    audio?: Buffer;
    audioTime = 9.8;
    readonly pixels: Buffer;
    constructor(readonly width: number, readonly height: number, withAudio = false) { this.pixels = Buffer.alloc(width * height * 4); if (withAudio) this.audio = Buffer.alloc(128); }
    async connect(): Promise<void> {}
    async pull(): Promise<number> { if (fixture.pullError) throw fixture.pullError; return fixture.pullHook?.() ?? 10; }
    close(): void { fixture.closedFrames++; }
  }
  class Writer {
    constructor(private failed: (error: Error) => void) {}
    async start(): Promise<void> { await fixture.writerHook?.(this.failed); }
    async write(pixels: unknown, time?: number): Promise<void> { if (fixture.writeError) throw fixture.writeError; fixture.streamWrites.push({ pixels, time }); }
    audio(data: Buffer, time: number): void { fixture.streamAudio.push({ data, time }); }
    async stop(): Promise<void> { fixture.stoppedWriter++; if (fixture.writerStopError) throw fixture.writerStopError; }
  }
  const context = { Native, Frames, Writer, diagnostics: fixture.diagnostics,
    preferences: { style: DEFAULT_STYLE, camera: { x: .8, y: .8 }, cameraShrinkOnZoom: false } };
  const module = { exports: {} }, require = createRequire(import.meta.url);
  new Function('require', 'module', 'exports', (await bundle).outputFiles[0].text)(
    (name: string) => name === 'live-session-context' ? context : require(name), module, module.exports);
  const Constructor = (module.exports as { LiveSession: typeof LiveSession }).LiveSession;
  fixture.session = new Constructor({
    deviceStatus: async () => ({ available: true, installed: fixture.deviceInstalled !== false, name: 'fixture' }),
    streamProfile: async id => {
      if (fixture.streamProfileError) throw fixture.streamProfileError;
      return { ...DEFAULT_STREAM_ENCODING, fps: 60, id, name: 'fixture', server: 'rtmp://localhost/live', key: 'owned-test' } as StreamProfile;
    },
    streamOutput: (_profile, changed, failed) => { fixture.streamChanged = changed; fixture.streamFailed = failed; return new Writer(failed); },
    idle: () => fixture.idle,
    sources: async () => [{ id: 'screen:fixture', kind: 'screen', name: 'Synthetic source', width: 1280, height: 720 }],
    camera: () => ({ status: 'idle', cameraAvailable: false }) as LiveRecordingState,
    prepare: async () => { fixture.prepared++; await fixture.prepareHook?.(); if (fixture.prepareError) throw fixture.prepareError; return []; },
    restore: async () => { fixture.restored++; if (fixture.restoreError) throw fixture.restoreError; },
    changed: state => fixture.states.push({ ...state }),
    demoOptions: () => fixture.demo ?? { captureOwnApp: false, ownAppVisible: false },
  });
  return fixture;
}
