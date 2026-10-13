import { LiveRuntime } from '../src/services/live/runtime';
import type { LiveApi, LiveConfiguration, LiveFrame } from '../shared/live-types';

interface Bridge {
  pull(): Promise<LiveFrame>;
  push(pixels: ArrayBuffer): Promise<void>;
  window(action: 'show' | 'hide' | 'minimize' | 'restore'): Promise<void>;
  visibility(callback: (visible: boolean) => void): () => void;
}
const bridge = (window as unknown as { displayFixture: Bridge }).displayFixture;
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

Object.assign(window, { runLiveDisplayChecks: async (config: LiveConfiguration) => {
  let frames = 0, copies = 0, progress = 0, displayFailures = 0, mounted = true, failDisplay = false;
  let fatal: unknown;
  let camera: MediaStream | null = null;
  const cameraSource = document.createElement('canvas'); cameraSource.width = 320; cameraSource.height = 180;
  const cameraContext = cameraSource.getContext('2d')!;
  let paint = 0, animate: ReturnType<typeof setInterval> | undefined;
  const paintCamera = () => { cameraContext.fillStyle = ++paint % 2 ? '#2d9f75' : '#4372b8'; cameraContext.fillRect(0, 0, 320, 180); };
  const startCamera = () => { paintCamera(); animate = setInterval(paintCamera, 33); };
  const cameras: MediaStream[] = [];
  const newCamera = () => {
    camera?.getTracks().forEach(track => track.stop());
    const stream = cameraSource.captureStream(30); cameras.push(stream); camera = stream;
  };
  startCamera(); newCamera();
  const notices: string[] = [];
  const root = document.createElement('div'); document.body.append(root);
  const api = { pull: () => bridge.pull(), push: async (_id: string, pixels: ArrayBuffer) => {
    check(pixels.byteLength === config.width * config.height * 4, 'Output dimensions changed with preview');
    await bridge.push(pixels); frames++;
  } } as unknown as LiveApi;
  const runtime = new LiveRuntime(api, config, () => camera, error => { fatal = error; }, {
    notice: issue => notices.push(issue),
    preview: canvas => {
      if (failDisplay) throw new Error('Owned display failure');
      check(canvas.width === 640 && canvas.height === 360, 'Preview must be bounded independently of output');
      if (canvas.parentElement !== root) root.replaceChildren(canvas);
      copies++;
    },
    visible: () => mounted,
    progress: level => { check(level > 0, 'Sound meter lost its signal'); progress++; },
    failed: () => { displayFailures++; },
  });
  const off = bridge.visibility(visible => runtime.setPreviewVisible(visible));
  let currentPhase = 'starting';
  const waitFrames = async (count: number) => {
    const target = frames + count, deadline = performance.now() + Math.max(15000, count * 3000 / config.fps);
    while (frames < target) {
      if (fatal) throw fatal;
      check(performance.now() < deadline, `Output stalled in ${currentPhase}: ${frames}/${target}`);
      await delay(5);
    }
  };
  const samples: { name: string; outputFrames: number; previewFrames: number; seconds: number; outputFps: number; documentHidden: boolean }[] = [];
  const sample = async (name: string, displaying: boolean, count = 60) => {
    currentPhase = name;
    await waitFrames(2);
    const started = performance.now(), before = frames, shown = copies, levels = progress;
    await waitFrames(count);
    const seconds = (performance.now() - started) / 1000;
    const displayCount = copies - shown;
    check(progress - levels >= count - 1, 'Output progress depends on display updates');
    check(displaying ? displayCount > 0 && displayCount <= Math.ceil(seconds * 10) + 1 : displayCount === 0, 'Unexpected display refresh count');
    samples.push({ name, outputFrames: frames - before, previewFrames: displayCount, seconds,
      outputFps: (frames - before) / seconds, documentHidden: document.hidden });
    console.log(JSON.stringify(samples.at(-1)));
  };
  try {
    const started = performance.now();
    await bridge.window('show'); runtime.start();
    await sample('visible', true);
    runtime.setPreviewEnabled(false); await sample('user-disabled', false);
    await bridge.window('hide'); runtime.setPreviewEnabled(true); await sample('native-hidden', false);
    await bridge.window('show'); await sample('native-restored', true);
    await bridge.window('minimize'); await sample('native-minimized', false);
    await bridge.window('restore'); await sample('native-unminimized', true);
    mounted = false; await sample('panel-unmounted', false);
    mounted = true; failDisplay = true; runtime.setPreviewEnabled(true);
    await sample('display-failed-output-continues', false); check(displayFailures === 1, 'Display failure was not isolated');
    failDisplay = false; runtime.setPreviewEnabled(true); await sample('display-recovered', true);
    clearInterval(animate);
    await sample('camera-stalled-output-continues', true, 240);
    check(notices.at(-1) === 'camera-unavailable', 'Camera stall was not isolated');
    startCamera(); await sample('camera-frame-recovered', true, 90);
    check(notices.at(-1) === 'camera-restored', 'Camera did not recover on new frames');
    camera!.getTracks().forEach(track => track.stop()); await sample('camera-ended-output-continues', true, 60);
    check(notices.at(-1) === 'camera-unavailable', 'Ended track must not end output');
    newCamera(); await sample('camera-replaced', true, 90);
    check(notices.at(-1) === 'camera-restored', 'Replacement camera did not recover');
    const video = document.querySelector('video')!, play = video.play;
    clearInterval(animate);
    video.pause(); video.play = () => Promise.reject(new Error('Owned playback rejection')); newCamera();
    await sample('camera-play-rejected-output-continues', true, 60);
    check(notices.at(-1) === 'camera-unavailable', 'Playback rejection was not isolated');
    video.pause(); video.play = () => new Promise(() => {}); newCamera();
    await sample('camera-play-pending-output-continues', true, 180);
    check(notices.at(-1) === 'camera-unavailable', 'Pending playback must not block output');
    video.play = play; startCamera(); newCamera(); await sample('camera-play-recovered', true, 90);
    check(notices.at(-1) === 'camera-restored', 'Playback recovery did not restore camera');
    const canvases = [...document.querySelectorAll('canvas')];
    check(canvases.length === 1 && canvases[0].width === 640, 'Full-size composition was mounted as a preview');
    await runtime.stop(); check(!document.querySelector('canvas,video'), 'Display resources were retained after stop');
    return { samples, frames, copies, progress, displayFailures, notices, seconds: (performance.now() - started) / 1000,
      released: true, output: { width: config.width, height: config.height, fps: config.fps } };
  } finally { off(); await runtime.stop(); clearInterval(animate); cameras.forEach(stream => stream.getTracks().forEach(track => track.stop())); root.remove(); }
} });
