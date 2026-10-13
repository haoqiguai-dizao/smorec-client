import { createRoot } from 'react-dom/client';
import { useRef } from 'react';
import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import { CameraPreviewRenderer } from '../src/services/camera-effects/preview-renderer';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import { useCameraEffectPreview } from '../src/hooks/useCameraEffectPreview';

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(condition: () => boolean, message: string) {
  const deadline = performance.now() + 8000;
  while (!condition()) { check(performance.now() < deadline, message); await delay(20); }
}
function canvas(width: number, height: number) {
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
}
function fixture() {
  const source = canvas(1920, 1080), context = source.getContext('2d')!;
  context.fillStyle = '#bf8b6c'; context.fillRect(0, 0, source.width, source.height);
  context.fillStyle = '#d79b78';
  for (let y = 0; y < source.height; y += 8) for (let x = 0; x < source.width; x += 8) context.fillRect(x, y, 2, 2);
  context.fillStyle = '#16191c'; context.fillRect(800, 120, 2, 800);
  return source;
}
function measure(source: HTMLCanvasElement, cpu: boolean) {
  const baseline = new CameraEffectsRenderer(), preview = new CameraPreviewRenderer(), target = canvas(1920, 1080);
  const output = target.getContext('2d')!;
  const original = HTMLCanvasElement.prototype.getContext;
  if (cpu) HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
    return type.startsWith('webgl') || type === 'experimental-webgl' ? null : Reflect.apply(original, this, [type, ...args]);
  } as typeof original;
  const collect = (draw: () => void) => {
    const samples = [];
    for (let index = 0; index < 8; index++) {
      const start = performance.now(); draw(); output.getImageData(0, 0, 1, 1);
      if (index > 1) samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { medianMilliseconds: samples[Math.floor(samples.length / 2)], maximumMilliseconds: samples.at(-1)!, samples };
  };
  try {
    const full = collect(() => { const frame = baseline.render(source, DEFAULT_CAMERA_EFFECTS); output.drawImage(frame, 0, 0); });
    const small = collect(() => {
      const frame = preview.render(source, DEFAULT_CAMERA_EFFECTS, { width: 256, height: 256 }, 1.5)!;
      if (target.width !== frame.width) target.width = frame.width;
      if (target.height !== frame.height) target.height = frame.height;
      output.drawImage(frame.source, 0, 0, frame.width, frame.height);
    });
    check(target.width === 683 && target.height === 384, 'Small preview must cover physical screen pixels');
    const dimensions = { width: target.width, height: target.height };
    const presenter = preview.render(source, DEFAULT_CAMERA_EFFECTS, { width: 960, height: 540 }, 2)!;
    check(presenter.width === 1920 && presenter.height === 1080, 'Large presenter must retain all available source detail');
    check(source.width === 1920 && source.height === 1080, 'Preview must not resize or overwrite the raw source');
    const exportFrame = baseline.render(source, DEFAULT_CAMERA_EFFECTS) as HTMLCanvasElement;
    check(exportFrame.width === 1920 && exportFrame.height === 1080, 'Shared export renderer must keep intrinsic source pixels');
    return { backend: baseline.backend, baseline: { width: 1920, height: 1080, ...full }, preview: { ...dimensions, ...small },
      medianWorkReduction: 1 - small.medianMilliseconds / full.medianMilliseconds,
      effectPixelReduction: 1 - dimensions.width * dimensions.height / (1920 * 1080), rawAndExportRemain1080p: true };
  } finally { HTMLCanvasElement.prototype.getContext = original; baseline.dispose(); preview.dispose(); }
}

function Preview({ stream, source, enabled = true }: { stream: MediaStream; source: HTMLCanvasElement; enabled?: boolean }) {
  const video = useRef(source as unknown as HTMLVideoElement), target = useRef<HTMLCanvasElement>(null);
  useCameraEffectPreview(video, target, stream, DEFAULT_CAMERA_EFFECTS, enabled);
  return <canvas ref={target} id="preview" style={{ width: 256, height: 256 }} />;
}

async function lifecycle(source: HTMLCanvasElement) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container), stream = source.captureStream(60), context = source.getContext('2d')!;
  const prior = Object.getOwnPropertyDescriptor(document, 'hidden'); let hidden = false, tick = 0, nextId = 0;
  const callbacks = new Map<number, VideoFrameRequestCallback>();
  // A hidden BrowserWindow does not present live video at normal cadence. Supply deterministic
  // decoded-frame callbacks over a real drawable canvas, without touching the capture device.
  Object.defineProperties(source, { readyState: { value: 4 }, videoWidth: { value: 1920 }, videoHeight: { value: 1080 },
    currentTime: { get: () => tick / 60 }, requestVideoFrameCallback: { value: (callback: VideoFrameRequestCallback) => {
      const id = ++nextId; callbacks.set(id, callback); return id;
    } }, cancelVideoFrameCallback: { value: (id: number) => callbacks.delete(id) } });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const timer = setInterval(() => {
    context.fillStyle = tick++ % 2 ? '#df8268' : '#769fbc'; context.fillRect(0, 0, 10, 10);
    const pending = [...callbacks.values()]; callbacks.clear();
    pending.forEach(callback => callback(performance.now(), { mediaTime: tick / 60, presentedFrames: tick } as VideoFrameCallbackMetadata));
  }, 1000 / 60);
  root.render(<Preview stream={stream} source={source} />);
  try {
    await until(() => !!document.querySelector<HTMLElement>('#preview')?.dataset.frameTime, 'Visible preview did not paint');
    const target = document.querySelector<HTMLCanvasElement>('#preview')!;
    let changes = 0;
    const observer = new MutationObserver(records => { changes += records.filter(record => record.attributeName === 'data-frame-time').length; });
    observer.observe(target, { attributes: true });
    const began = performance.now(); await delay(650);
    const paintsPerSecond = changes / ((performance.now() - began) / 1000);
    check(paintsPerSecond > 15 && paintsPerSecond <= 33, 'Display preview must remain responsive without rendering at source 60fps');
    hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    check(callbacks.size === 0, 'Hidden display must cancel its decoded-frame callback');
    const before = target.dataset.frameTime, beforeHidden = changes;
    await delay(250);
    check(target.dataset.frameTime === before && changes === beforeHidden, 'Hidden display must stop frame processing');
    const hiddenPaints = changes - beforeHidden;
    hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    await until(() => target.dataset.frameTime !== before, 'Visible display did not resume its existing stream');
    // Electron's backgroundThrottling:false deliberately keeps document.hidden false.
    // Live camera visibility therefore also gates processing through the explicit enabled input.
    root.render(<Preview stream={stream} source={source} enabled={false} />);
    await until(() => callbacks.size === 0, 'Explicitly hidden camera did not cancel processing');
    const disabledFrame = target.dataset.frameTime;
    await delay(250);
    check(target.dataset.frameTime === disabledFrame && callbacks.size === 0, 'Hidden camera still painted with document.hidden=false');
    root.render(<Preview stream={stream} source={source} />);
    await until(() => target.dataset.frameTime !== disabledFrame, 'Camera visibility did not resume processing');
    const settings = stream.getVideoTracks()[0].getSettings();
    check(settings.width === 1920 && settings.height === 1080 && stream.getVideoTracks()[0].readyState === 'live', 'Display hiding must preserve the raw capture track');
    observer.disconnect();
    return { frameSource: 'controlled 60fps decoded-frame callbacks', paintsPerSecond, hiddenPaints, hiddenPauseVerified: true,
      explicitVisibilityPauseVerified: true, resumed: true,
      raw: { width: settings.width, height: settings.height, frameRate: settings.frameRate } };
  } finally {
    root.unmount(); container.remove(); clearInterval(timer); stream.getTracks().forEach(track => track.stop());
    if (prior) Object.defineProperty(document, 'hidden', prior); else delete (document as unknown as Record<string, unknown>).hidden;
  }
}

Object.assign(window, { runCameraPreviewPerformance: async () => {
  const source = fixture();
  const gpu = measure(source, false), cpu = measure(source, true);
  return { measuredOnlySyntheticPreview: true, gpu, cpu, lifecycle: await lifecycle(source) };
} });
