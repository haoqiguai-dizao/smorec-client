import { CameraPreviewSender } from '../src/services/camera-preview-sender';
import { CameraEffectsRenderer } from '../src/services/camera-effects/renderer';
import { WebcamRecorder } from '../src/services/webcam-recorder';
import { cameraEffectsStrengthChecks } from './camera-effects-strength-harness';
import type { CameraPreviewMessage, CameraRecordingApi, CameraEffects } from '../shared/types';

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(read: () => boolean, label: string, timeout = 15000) {
  const deadline = performance.now() + timeout;
  while (!read()) { if (performance.now() > deadline) throw new Error('Timed out: ' + label); await wait(25); }
}
function canvas(width: number, height: number) {
  const result = document.createElement('canvas'); result.width = width; result.height = height; return result;
}
function fixture(width: number, height: number) {
  const source = canvas(width, height), context = source.getContext('2d')!;
  context.fillStyle = '#40464b'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#c89478'; context.fillRect(40, 50, 300, 300);
  context.fillStyle = '#b88169';
  for (let y = 60; y < 350; y += 4) for (let x = 50; x < 340; x += 4) context.fillRect(x, y, 1, 1);
  context.fillStyle = 'white'; context.font = '32px sans-serif'; context.fillText('Synthetic camera detail ' + width + ' x ' + height, 30, height - 55);
  for (let x = 0; x < 256; x++) {
    context.fillStyle = Math.floor(x / 2) % 2 ? '#ffffff' : '#000000';
    context.fillRect(400 + x, 120, 1, 256);
  }
  return source;
}
function pixels(source: CanvasImageSource, width: number, height: number) {
  const target = canvas(width, height), context = target.getContext('2d')!;
  context.drawImage(source, 0, 0, width, height);
  return { target, data: context.getImageData(0, 0, width, height).data };
}
function detail(data: Uint8ClampedArray, width: number) {
  let light = 0, dark = 0;
  for (let y = 140; y < 356; y++) for (let x = 400; x < 656; x++) {
    const value = data[(y * width + x) * 4];
    if (Math.floor((x - 400) / 2) % 2) light += value; else dark += value;
  }
  return (light - dark) / (216 * 128);
}
function difference(first: Uint8ClampedArray, second: Uint8ClampedArray) {
  let maximum = 0, sum = 0;
  for (let index = 0; index < first.length; index++) {
    const delta = Math.abs(first[index] - second[index]); maximum = Math.max(maximum, delta); sum += delta;
  }
  return { maximum, mean: sum / first.length };
}
function effectsCheck() {
  const source = fixture(1920, 1080), settings: CameraEffects = { enabled: true, smoothing: .25, brightness: .18, filter: 'natural', intensity: .3 };
  const gpu = new CameraEffectsRenderer(), cpu = new CameraEffectsRenderer();
  try {
    const gpuStart = performance.now(), rendered = gpu.render(source, settings) as HTMLCanvasElement;
    const gpuMs = performance.now() - gpuStart;
    check(gpu.backend === 'gpu', 'GPU detail check requires a real WebGL context');
    check(rendered.width === 1920 && rendered.height === 1080, 'Effects must preserve 1080p intrinsic pixels');
    const gpuPixels = pixels(rendered, 1920, 1080);
    // Force the fallback only for this renderer; no application preferences or GPU settings change.
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return type.startsWith('webgl') || type === 'experimental-webgl' ? null : Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
    let cpuRendered: HTMLCanvasElement, cpuMs: number;
    try { const start = performance.now(); cpuRendered = cpu.render(source, settings) as HTMLCanvasElement; cpuMs = performance.now() - start; }
    finally { HTMLCanvasElement.prototype.getContext = original; }
    check(cpu.backend === 'cpu', 'CPU fallback must be exercised');
    check(cpuRendered.width === 1920 && cpuRendered.height === 1080, 'CPU fallback must preserve 1080p detail');
    const cpuPixels = pixels(cpuRendered, 1920, 1080), delta = difference(gpuPixels.data, cpuPixels.data);
    check(detail(gpuPixels.data, 1920) > 220, 'Effects erased two-pixel detail');
    check(delta.mean < .35 && delta.maximum <= 5, 'GPU and CPU effects diverged: ' + JSON.stringify(delta));
    const context = source.getContext('2d')!; context.fillStyle = '#1594e8'; context.fillRect(800, 400, 20, 20);
    const next = gpu.render(source, settings);
    const nextPixels = pixels(next, 1920, 1080).data;
    const sample = (405 * 1920 + 805) * 4;
    check(Math.abs(nextPixels[sample + 2] - gpuPixels.data[sample + 2]) > 100, 'Reused source object did not upload its new pixels');
    check(gpu.render(source, { ...settings, enabled: false }) === source, 'Disabled effects must return the original source');
    return { width: rendered.width, height: rendered.height, contrast: detail(gpuPixels.data, 1920), gpuMs, cpuMs,
      gpuCpuDifference: delta, consecutiveFrameUpdated: true, image: gpuPixels.target.toDataURL('image/png') };
  } finally { gpu.dispose(); cpu.dispose(); }
}

async function peerCheck(width: number, height: number) {
  const source = fixture(width, height), context = source.getContext('2d')!;
  const stream = source.captureStream(30), receiver = new RTCPeerConnection({ iceServers: [] });
  const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true; document.body.append(video);
  const requests = new Set<(id: string) => void>(), responses = new Set<(message: CameraPreviewMessage) => void>();
  const sessionId = crypto.randomUUID(), pending: RTCIceCandidateInit[] = [], signals: string[] = [], errors: unknown[] = [];
  let queue = Promise.resolve(), tick = 0;
  const timer = setInterval(() => { context.fillStyle = tick++ % 2 ? '#f35c51' : '#4598e8'; context.fillRect(width - 50, height - 50, 20, 20); }, 1000 / 30);
  receiver.ontrack = event => { video.srcObject = event.streams[0] ?? new MediaStream([event.track]); void video.play().catch(error => errors.push(error)); };
  receiver.onicecandidate = event => { if (event.candidate) for (const listener of responses) listener({ sessionId,
    signal: { type: 'candidate', candidate: event.candidate.toJSON() } }); };
  const api = {
    onCameraPreviewRequest: (callback: (id: string) => void) => { requests.add(callback); return () => requests.delete(callback); },
    onCameraPreviewSignal: (callback: (message: CameraPreviewMessage) => void) => { responses.add(callback); return () => responses.delete(callback); },
    cameraPreviewSignal: (message: CameraPreviewMessage) => {
      signals.push(message.signal.type);
      queue = queue.then(async () => {
        const signal = message.signal;
        if (signal.type === 'candidate' && signal.candidate) {
          if (receiver.remoteDescription) await receiver.addIceCandidate(signal.candidate); else pending.push(signal.candidate);
        } else if (signal.type === 'offer') {
          await receiver.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
          for (const candidate of pending.splice(0)) await receiver.addIceCandidate(candidate);
          await receiver.setLocalDescription(await receiver.createAnswer());
          for (const listener of responses) listener({ sessionId, signal: { type: 'answer', sdp: receiver.localDescription!.sdp } });
        }
      }).catch(error => { errors.push(error); });
      return queue;
    },
  } as unknown as CameraRecordingApi;
  const sender = new CameraPreviewSender(api, stream);
  try {
    for (const listener of requests) listener(sessionId);
    for (const listener of responses) listener({ sessionId, signal: { type: 'viewport',
      viewport: { width, height, density: 1, visible: true, revision: 1 } } });
    try { await until(() => video.readyState >= 2 && video.videoWidth === width && video.videoHeight === height, 'full-size WebRTC frames'); }
    catch (error) {
      throw new Error(String(error) + ' ' + JSON.stringify({ expected: { width, height }, actual: { width: video.videoWidth, height: video.videoHeight,
        readyState: video.readyState }, state: receiver.connectionState, ice: receiver.iceConnectionState, signals,
        errors: errors.map(String), stats: [...(await receiver.getStats()).values()].filter(item => item.type === 'inbound-rtp' || item.type === 'candidate-pair') }), { cause: error });
    }
    const firstStats = await receiver.getStats();
    await wait(1800);
    const finalStats = await receiver.getStats();
    const inbound = [...finalStats.values()].find(item => item.type === 'inbound-rtp' && item.kind === 'video');
    check(inbound, 'Missing actual inbound RTP statistics');
    const first = firstStats.get(inbound.id), measuredFps = (inbound.framesDecoded - (first?.framesDecoded ?? 0)) / ((inbound.timestamp - (first?.timestamp ?? inbound.timestamp - 1800)) / 1000);
    check(measuredFps > 20, 'Local preview did not exceed the old 20 FPS ceiling: ' + measuredFps);
    const received = pixels(video, width, height), contrast = detail(received.data, width);
    const receivedSize = { width: video.videoWidth, height: video.videoHeight };
    check(contrast > 180, 'Local peer lost the two-pixel source detail: ' + contrast);
    check(errors.length === 0, 'WebRTC errors: ' + String(errors));
    sender.dispose(); receiver.close();
    check(stream.getVideoTracks()[0].readyState === 'live', 'Closing preview must not stop the recording track');
    const archive = await archiveCheck(stream, width, height);
    return { source: { width, height }, received: { ...receivedSize, contrast, measuredFps,
      framesDecoded: inbound.framesDecoded, bytesReceived: inbound.bytesReceived, codecId: inbound.codecId }, signals,
      archive, image: received.target.toDataURL('image/png') };
  } finally { sender.dispose(); receiver.close(); clearInterval(timer); stream.getTracks().forEach(track => track.stop()); video.pause(); video.srcObject = null; video.remove(); }
}

async function archiveCheck(stream: MediaStream, width: number, height: number) {
  const chunks: ArrayBuffer[] = [], calls: string[] = [];
  let mimeType = '';
  const api = { cameraStarted: async (_id: string, _time: number, actual: string) => { mimeType = actual; calls.push('started'); }, cameraAppend: async (_id: string, bytes: ArrayBuffer) => { chunks.push(bytes); },
    cameraFinish: async () => { calls.push('finished'); }, cameraCancel: async () => { calls.push('canceled'); } } as unknown as CameraRecordingApi;
  const recorder = new WebcamRecorder('synthetic', stream, api);
  await recorder.start(); await wait(900); await recorder.finish();
  check(calls.join() === 'started,finished', 'Archive did not finish normally');
  check(mimeType, 'Archive must acknowledge its actual container');
  const blob = new Blob(chunks, { type: mimeType }), url = URL.createObjectURL(blob), video = document.createElement('video');
  video.muted = true; video.src = url;
  try {
    await video.play(); await until(() => video.readyState >= 2, 'archive decode'); video.pause();
    check(video.videoWidth === width && video.videoHeight === height, 'Raw camera recording lost source dimensions');
    const contrast = detail(pixels(video, width, height).data, width);
    check(contrast > 180, 'Raw camera recording lost fine detail');
    return { width: video.videoWidth, height: video.videoHeight, bytes: blob.size, contrast, finished: true };
  } finally { video.pause(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

declare global { interface Window { runCameraQualityChecks: () => Promise<unknown> } }
window.runCameraQualityChecks = async () => ({ effects: effectsCheck(), strength: cameraEffectsStrengthChecks(),
  peers: [await peerCheck(1280, 720), await peerCheck(1920, 1080)] });
