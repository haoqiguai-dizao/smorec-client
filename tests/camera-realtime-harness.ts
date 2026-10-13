import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import { ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';
import { markMediaFrame } from '../src/services/media-frame-identity';
import './camera-preview-transport-harness';
import { verifyCameraPlayback } from './camera-playback-harness';

const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const effects = { ...ORIGINAL_CAMERA_EFFECTS, enabled: true, skinWhitening: .85 };

async function faceSequence() {
  const image = new Image(); image.src = 'portrait.png'; await image.decode();
  const source = document.createElement('canvas'); source.width = source.height = 384;
  source.getContext('2d')!.drawImage(image, 0, 0, 384, 384);
  const output = document.createElement('canvas'); output.width = output.height = 384;
  document.querySelector('#frames')!.append(source, output);
  const context = output.getContext('2d', { willReadFrequently: true })!;
  const raw = source.getContext('2d')!.getImageData(0, 0, 384, 384).data;
  const NativeWorker = window.Worker;
  let requests = 0, inflight = 0, maximumInflight = 0;
  let sentAt = 0;
  const inferenceMs: number[] = [];
  // Real local model and shader, with deterministic late/missed inference replies.
  class DelayedWorker extends NativeWorker {
    listener: ((event: MessageEvent) => void) | null = null;
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      super.onmessage = event => {
        const miss = requests % 5 === 0;
        setTimeout(() => {
          inferenceMs.push(performance.now() - sentAt);
          inflight--;
          const data = miss && event.data.points ? { ...event.data, points: [] } : event.data;
          this.listener?.(new MessageEvent('message', { data }));
        }, 95);
      };
    }
    override get onmessage() { return this.listener; }
    override set onmessage(value) { this.listener = value; }
    override postMessage(message: unknown, transfer: Transferable[] | StructuredSerializeOptions = []) {
      requests++; maximumInflight = Math.max(maximumInflight, ++inflight);
      sentAt = performance.now();
      if (Array.isArray(transfer)) super.postMessage(message, transfer);
      else super.postMessage(message, transfer);
    }
  }
  window.Worker = DelayedWorker;
  const renderer = new CameraEffectsRenderer();
  const samples: { time: number; gain: number; frameMs: number }[] = [];
  try {
    const start = performance.now();
    while (performance.now() - start < 6000) {
      const began = performance.now(), time = (began - start) / 1000;
      markMediaFrame(source, 'continuous-clip', time);
      context.drawImage(renderer.render(source, effects), 0, 0);
      const pixels = context.getImageData(0, 0, 384, 384).data;
      let gain = 0;
      for (let i = 0; i < pixels.length; i += 4) gain += (pixels[i] - raw[i]) + (pixels[i + 1] - raw[i + 1]) + (pixels[i + 2] - raw[i + 2]);
      samples.push({ time, gain: gain / (384 * 384 * 3), frameMs: performance.now() - began });
      await delay(Math.max(0, 1000 / 30 - (performance.now() - began)));
    }
    const stable = samples.filter(sample => sample.time > 2);
    const gains = stable.map(sample => sample.gain).sort((a, b) => a - b);
    const median = gains[Math.floor(gains.length / 2)];
    const min = gains[0], max = gains.at(-1)!;
    check(median > .05, 'Whitening must actually alter face pixels, not silently bypass');
    check(min > median * .6, 'Whitening dropped out under bounded delayed/missed inference: ' + JSON.stringify({ min, median, max, inferenceMs, samples: stable }));
    check(maximumInflight === 1, 'Inference work must stay bounded');
    const frameMs = stable.map(sample => sample.frameMs).sort((a, b) => a - b);
    return { actualLocalModel: true, backend: renderer.backend, delayedRepliesMs: 95, missedEveryNthReply: 5,
      frames: samples.length, inferenceRequests: requests, maximumInflight, minGain: min, medianGain: median, maxGain: max,
      maxGainStep: Math.max(...stable.slice(1).map((sample, i) => Math.abs(sample.gain - stable[i].gain))),
      frameMsP95: frameMs[Math.floor(frameMs.length * .95)], samples };
  } finally { renderer.dispose(); window.Worker = NativeWorker; }
}

async function exactFrames() {
  const image = new Image(); image.src = 'portrait.png'; await image.decode();
  const source = document.createElement('canvas'); source.width = source.height = 320;
  source.getContext('2d')!.drawImage(image, 0, 0, 320, 320);
  const renderer = new CameraEffectsRenderer(), output = document.createElement('canvas');
  output.width = output.height = 320;
  const context = output.getContext('2d')!;
  const render = async (time: number) => {
    markMediaFrame(source, 'exact-export', time);
    await renderer.prepare(source, effects);
    context.drawImage(renderer.render(source, effects), 0, 0);
    return context.getImageData(0, 0, 320, 320).data;
  };
  try {
    const first = await render(1);
    await render(3);
    const again = await render(1);
    check(first.every((value, i) => value === again[i]), 'Exact export results must remain deterministic after a seek');
    return { deterministicExactExport: true, actualLocalModel: true };
  } finally { renderer.dispose(); }
}

const reports = document.querySelector('#report')!;
const run = async (name: string, task: () => Promise<unknown>) => {
  reports.textContent = JSON.stringify({ status: 'running', name });
  try {
    reports.textContent = JSON.stringify({ status: 'PASS', name, result: await task() }, null, 2);
    await fetch('/reports/' + name, { method: 'POST', body: reports.textContent });
  }
  catch (error) { reports.textContent = JSON.stringify({ status: 'FAIL', name, error: String(error) }, null, 2); }
};
document.querySelector('#face')!.addEventListener('click', () => void run('face-continuity', faceSequence));
document.querySelector('#exact')!.addEventListener('click', () => void run('exact-export', exactFrames));
document.querySelector('#playback')!.addEventListener('click', () => void run('video-playback', verifyCameraPlayback));
document.querySelector('#rtc')!.addEventListener('click', () => void run('rtc-archive',
  () => (window as unknown as { runCameraPreviewTransport: () => Promise<unknown> }).runCameraPreviewTransport()));
