import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { DEFAULT_STYLE } from '../../shared/constants';
import type { Project } from '../../shared/types';
import type { decodeFrames } from '../../src/services/decode-video';
import type { mediaFrameIdentity } from '../../src/services/media-frame-identity';

export function decodingProject(): Project {
  return { id: 'decode-fixture', name: 'Decode', createdAt: '', duration: 10, width: 3840, height: 2160, fps: 60,
    clips: [{ id: 'clip', start: 0, end: 10 }], cursor: [], zooms: [],
    media: { screen: 'screen.mp4', camera: 'camera.mp4' }, style: { ...DEFAULT_STYLE },
    audio: { system: 0, microphone: 0 }, camera: { enabled: true, offset: 0, position: 'bottom-right',
      size: .25, shape: 'rounded', mirror: false, shrinkOnZoom: false } };
}

export interface DecodeOptions {
  beforeFrame?: (track: string, time: number) => Promise<void>;
  endAt?: number;
  sourceFps?: number;
  last?: number;
}

/** No Electron, media codecs, canvas allocation or physical devices. */
export async function decodingFixture(options: DecodeOptions = {}) {
  const state = { opened: [] as string[], disposed: [] as string[], returned: [] as string[],
    requested: [] as { track: string; time: number }[], pools: [] as number[] };
  const injected = {
    opened: (url: string) => { state.opened.push(url); },
    disposed: (url: string) => { state.disposed.push(url); },
    last: options.last ?? 10,
    async *iterator(track: string, timestamps: Generator<number>, poolSize: number) {
      state.pools.push(poolSize);
      const pool = Array.from({ length: poolSize }, () => ({ time: -1, width: 3840, height: 2160 }));
      let count = 0;
      try {
        for (const time of timestamps) {
          state.requested.push({ track, time });
          await options.beforeFrame?.(track, time);
          if (time === options.endAt) return;
          const canvas = pool[count++ % pool.length];
          const timestamp = options.sourceFps ? Math.floor(time * options.sourceFps) / options.sourceFps : time;
          canvas.time = timestamp;
          yield { canvas, timestamp };
        }
      } finally { state.returned.push(track); }
    },
  };
  const bundled = await build({ stdin: { contents: `export { decodeFrames } from './src/services/decode-video';
    export { mediaFrameIdentity } from './src/services/media-frame-identity';`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
    plugins: [{ name: 'decode-fixture', setup(builder) {
      builder.onResolve({ filter: /^mediabunny$/ }, () => ({ path: 'mediabunny', namespace: 'decode-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'decode-fixture' }, () => ({ contents: `
        export const MP4 = {}, WEBM = {};
        export class UrlSource { constructor(url) { this.url = url; } }
        export class Input {
          constructor({ source }) { this.url = source.url; injected.opened(this.url); }
          async getPrimaryVideoTrack() { return { url: this.url, canDecode: async () => true,
            getFirstTimestamp: async () => 0, computeDuration: async () => injected.last }; }
          dispose() { if (!this.disposed) { this.disposed = true; injected.disposed(this.url); } }
        }
        export class CanvasSink {
          constructor(track, options) { this.track = track; this.options = options; }
          canvasesAtTimestamps(times) { return injected.iterator(this.track.url, times, this.options.poolSize); }
        }
      ` }));
    } }] });
  const module = { exports: {} as { decodeFrames: typeof decodeFrames; mediaFrameIdentity: typeof mediaFrameIdentity } };
  new Function('require', 'module', 'exports', 'injected', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, injected);
  return { ...module.exports, state };
}
