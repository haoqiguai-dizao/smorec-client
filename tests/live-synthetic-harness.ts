import { LiveRuntime } from '../src/services/live/runtime';
import type { LiveApi, LiveConfiguration } from '../shared/live-types';

const bridge = (window as unknown as { smokeApi: LiveApi }).smokeApi;
(window as unknown as { runLiveSmoke: (config: LiveConfiguration, stall?: boolean) => Promise<unknown> }).runLiveSmoke = async (config, stall = false) => {
  let count = 0, maxPixels = 0;
  const started = performance.now();
  let resolve!: () => void, reject!: (error: unknown) => void;
  const done = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#10d080'; ctx.fillRect(0, 0, 320, 180);
  const stream = canvas.captureStream(30);
  const animation = setInterval(() => { ctx.fillRect(0, 0, 320, 180); }, 30);
  const api: LiveApi = { ...bridge,
    pull: async id => {
      const frame = await bridge.pull(id);
      frame.input.push({ activity: { t: frame.time, kind: 'typing', focus: { x: .7, y: .4 } } });
      return frame;
    },
    push: async (id, pixels) => {
      maxPixels = Math.max(maxPixels, pixels.byteLength);
      await bridge.push(id, pixels);
      ++count;
      if (stall && count === 10) clearInterval(animation);
      if (count >= (stall ? 240 : 60)) resolve();
    },
  };
  const notices: string[] = [];
  const runtime = new LiveRuntime(api, config, () => stream, reject, { notice: issue => notices.push(issue) });
  const timer = setTimeout(() => reject(new Error('Live smoke timed out')), 30000);
  try {
    runtime.start(); await done; await runtime.stop();
    return { frames: count, bytes: maxPixels, measuredFps: Math.round(count / ((performance.now() - started) / 1000) * 10) / 10,
      width: config.width, height: config.height, documentHidden: document.hidden, cameraStallIsolated: notices.includes('camera-unavailable') };
  } finally { clearTimeout(timer); clearInterval(animation); stream.getTracks().forEach(track => track.stop()); await bridge.stop(); await runtime.stop(); }
};
