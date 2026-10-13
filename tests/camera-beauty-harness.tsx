import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CameraSettingsPanel } from '../src/components/recording-overlay/CameraSettingsPanel';
import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import type { CameraEffects, LiveRecordingState } from '../shared/types';
import '../src/styles/recording-overlay.css';

declare global {
  interface Window {
    legacyBeauty: { applyCameraEffects: (input: ImageData, output: ImageData, settings: CameraEffects) => void };
    beautyUi: { value: CameraEffects; comparing: boolean; disabled: boolean; setDisabled: (value: boolean) => void };
    beautyChecks: () => Promise<unknown>;
    beautyLifecycle: () => Promise<unknown>;
  }
}
function Harness() {
  const [value, setValue] = useState<CameraEffects>({ ...DEFAULT_CAMERA_EFFECTS });
  const [comparing, setComparing] = useState(false), [disabled, setDisabled] = useState(false);
  window.beautyUi = { value, comparing, disabled, setDisabled };
  const state: LiveRecordingState = { status: 'idle', cameraAvailable: true, cameraVisible: true,
    cameraPreviewing: true, cameraShape: 'circle', cameraSize: .3, cameraMirror: true, cameraEffects: value,
    cameraMode: 'overlay', microphoneEnabled: false, microphoneMuted: false, microphoneName: '',
    systemAudioEnabled: false, systemAudioMuted: false,
    cameraPanel: { camera: { x: 0, y: 0, width: 280, height: 280 }, settings: { x: 24, y: 24, width: 280, height: 550 } } };
  return <div className="camera-overlay-window"><CameraSettingsPanel state={state} disabled={disabled}
    onClose={() => {}} onCompare={setComparing} control={async action => {
      if (action.type === 'camera-effects') setValue(current => ({ ...current, ...action.value }));
    }} /></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);

function canvas(width: number, height: number) {
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
}
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function load(file: string) {
  const image = new Image(); image.src = './fixtures/' + file; await image.decode();
  const source = canvas(image.naturalWidth, image.naturalHeight); source.getContext('2d')!.drawImage(image, 0, 0);
  return source;
}
function pixels(source: CanvasImageSource, width: number, height: number) {
  const copy = canvas(width, height), ctx = copy.getContext('2d')!; ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, width, height);
}
function difference(a: ImageData, b: ImageData) {
  let sum = 0, maximum = 0;
  for (let i = 0; i < a.data.length; i++) {
    const value = Math.abs(a.data[i] - b.data[i]); sum += value; maximum = Math.max(maximum, value);
  }
  return { mean: sum / a.data.length, maximum };
}
function portrait(source: HTMLCanvasElement, face: number[]) {
  const renderer = new CameraEffectsRenderer(), { width, height } = source;
  const input = pixels(source, width, height);
  const settings: CameraEffects = { ...DEFAULT_CAMERA_EFFECTS, smoothing: .75, brightness: 0, intensity: 0 };
  const legacy = canvas(width, height), legacyCtx = legacy.getContext('2d')!, legacyData = legacyCtx.createImageData(width, height);
  window.legacyBeauty.applyCameraEffects(input, legacyData, settings); legacyCtx.putImageData(legacyData, 0, 0);
  const cropHeight = Math.round(width * face[3] / face[2]);
  const sheet = canvas(width * 4, height + 52 + cropHeight), ctx = sheet.getContext('2d')!;
  ctx.fillStyle = '#16191e'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  const draw = (image: CanvasImageSource, column: number, label: string) => {
    ctx.fillStyle = '#f2f3f4'; ctx.font = '18px sans-serif'; ctx.fillText(label, column * width + 12, 28);
    ctx.drawImage(image, column * width, 44, width, height);
    ctx.drawImage(image, face[0], face[1], face[2], face[3], column * width, height + 52, width, cropHeight);
  };
  try {
    draw(source, 0, 'Original'); draw(legacy, 1, 'Previous / smoothing 75%');
    const current = renderer.render(source, settings);
    check(renderer.backend === 'gpu', 'Portrait must exercise real GPU rendering');
    const currentPixels = pixels(current, width, height);
    draw(current, 2, 'Upgrade / smoothing 75%');
    const natural = renderer.render(source, DEFAULT_CAMERA_EFFECTS);
    draw(natural, 3, 'Upgrade / natural preset');
    const rawAfter = pixels(source, width, height);
    check(difference(input, rawAfter).maximum === 0, 'Portrait source was modified');
    return { image: sheet.toDataURL(), width, height, upgradeVsPrevious: difference(currentPixels, legacyData),
      upgradeVsOriginal: difference(currentPixels, input), originalUnchanged: true };
  } finally { renderer.dispose(); }
}

async function performanceCheck(portraitSource: HTMLCanvasElement) {
  const results = [];
  for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) {
    console.log('Beauty benchmark ' + width + 'x' + height);
    const source = canvas(width, height), ctx = source.getContext('2d')!;
    ctx.drawImage(portraitSource, 0, 0, width, height);
    const target = canvas(width, height), output = target.getContext('2d', { willReadFrequently: true })!;
    const renderer = new CameraEffectsRenderer(), timings: number[] = [];
    try {
      for (let frame = 0; frame < 25; frame++) {
        await new Promise<void>(resolve => setTimeout(resolve, 1));
        // Mutate the input each frame to catch stale texture reuse.
        ctx.fillStyle = frame % 2 ? '#ff0000' : '#00ff00'; ctx.fillRect(0, 0, 8, 8);
        const started = performance.now();
        const result = renderer.render(source, { ...DEFAULT_CAMERA_EFFECTS, smoothing: .75 });
        output.drawImage(result, 0, 0);
        // A forced read synchronizes submitted GPU work; submission time alone is misleading.
        const sample = output.getImageData(0, 0, 1, 1).data;
        check(frame % 2 ? sample[0] > sample[1] : sample[1] > sample[0], 'Stale GPU frame');
        const elapsed = performance.now() - started;
        if (frame >= 5) timings.push(elapsed);
        check(renderer.backend === 'gpu', 'GPU benchmark fell back to CPU');
      }
      timings.sort((a, b) => a - b);
      results.push({ width, height, samples: timings.length, medianMs: timings[10], p95Ms: timings[18], maximumMs: timings.at(-1),
        includesGpuSynchronization: true });
    } finally { renderer.dispose(); }
  }
  return results;
}

async function lifecycleCheck() {
  const source = canvas(640, 360), ctx = source.getContext('2d')!;
  ctx.fillStyle = '#bf8b6c'; ctx.fillRect(0, 0, 640, 360);
  const renderer = new CameraEffectsRenderer();
  const original = HTMLCanvasElement.prototype.getContext;
  let gl: WebGLRenderingContext | undefined;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
    const result = Reflect.apply(original, this, [type, ...args]);
    if (type === 'webgl' && result) gl = result;
    return result;
  } as typeof original;
  try {
    renderer.render(source, DEFAULT_CAMERA_EFFECTS);
  } finally { HTMLCanvasElement.prototype.getContext = original; }
  try {
    check(renderer.backend === 'gpu', 'Initial lifecycle frame must use GPU');
    const extension = gl?.getExtension('WEBGL_lose_context'); check(extension && gl, 'Context loss extension unavailable');
    const lost = new Promise<void>(resolve => gl!.canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }));
    console.log('Beauty context loss');
    extension.loseContext(); await lost;
    renderer.render(source, DEFAULT_CAMERA_EFFECTS);
    check(String(renderer.backend) === 'cpu', 'Lost context must execute CPU fallback');
    const restored = new Promise<void>(resolve => gl!.canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true }));
    await new Promise<void>(resolve => setTimeout(resolve, 100));
    console.log('Beauty context restore');
    extension.restoreContext(); await restored;
    renderer.render(source, DEFAULT_CAMERA_EFFECTS);
    check(String(renderer.backend) === 'gpu', 'Restored context must resume GPU processing');
    for (const [width, height] of [[853, 479], [1920, 1080], [480, 270]]) {
      source.width = width; source.height = height; ctx.fillStyle = '#bf8b6c'; ctx.fillRect(0, 0, width, height);
      const frame = renderer.render(source, DEFAULT_CAMERA_EFFECTS) as HTMLCanvasElement;
      check(frame.width === width && frame.height === height && renderer.backend === 'gpu', 'Resize lost pixels or GPU state');
    }
    return { lossFallback: true, recovery: true, resize: true };
  } finally { renderer.dispose(); }
}

window.beautyChecks = async () => {
  console.log('Beauty load fixtures');
  const hopper = await load('grace_hopper.jpg'), astronaut = await load('astronaut.png');
  console.log('Beauty portrait comparison');
  return { portraits: { hopper: portrait(hopper, [155, 130, 215, 215]), astronaut: portrait(astronaut, [175, 60, 110, 110]) },
    performance: await performanceCheck(hopper) };
};
window.beautyLifecycle = lifecycleCheck;
