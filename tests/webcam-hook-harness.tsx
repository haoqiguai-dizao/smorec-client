import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { useWebcam } from '../src/hooks/useWebcam';
import type { CameraCommand, RecorderApi } from '../shared/types';
import { readAppPreferences } from '../src/services/app-preferences';

class Track extends EventTarget {
  readyState = 'live';
  constructor(readonly deviceId: string) { super(); }
  stop() { this.readyState = 'ended'; }
  getSettings() { return { deviceId: this.deviceId }; }
}
class Recorder extends EventTarget {
  static isTypeSupported() { return true; }
  readonly mimeType: string;
  constructor(_stream: MediaStream, options: MediaRecorderOptions) { super(); this.mimeType = options.mimeType ?? ''; }
  state = 'inactive';
  start() { this.state = 'recording'; queueMicrotask(() => this.dispatchEvent(new Event('start'))); }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([new Uint8Array([1])]) }));
      this.dispatchEvent(new Event('stop'));
    });
  }
}
let latest: ReturnType<typeof useWebcam>;
let lease: string | null = null;
const prepares: { id: string; resolve: (value: { id: string }) => void; reject: (reason: Error) => void }[] = [];
const media: { deviceId: string; track?: Track; resolve: (value: MediaStream) => void }[] = [];
const cancels: string[] = [], errors: string[] = [];
let notice: string | undefined;
const commands = new Set<(command: CameraCommand) => unknown>();
localStorage.clear();
window.recorder = {
  cameraPrepare: () => {
    if (lease) return Promise.reject(new Error('旧摄像头会话尚未释放'));
    const id = 'lease-' + (prepares.length + 1); lease = id;
    return new Promise((resolve, reject) => prepares.push({ id, resolve, reject }));
  },
  cameraCancel: async (id: string) => { cancels.push(id); if (lease === id) lease = null; },
  cameraStarted: async () => {},
  cameraAppend: async () => {},
  cameraFinish: async (id: string) => { if (lease === id) lease = null; },
  onCameraCommand: (callback: (command: CameraCommand) => void) => { commands.add(callback); return () => { commands.delete(callback); }; },
  onCameraPreviewRequest: () => () => {},
  onCameraPreviewSignal: () => () => {},
} as unknown as RecorderApi;
Object.defineProperty(globalThis, 'MediaRecorder', { configurable: true, value: Recorder });
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: (constraints: MediaStreamConstraints) => {
  const video = constraints.video as MediaTrackConstraints;
  const deviceId = (video.deviceId as ConstrainDOMStringParameters | undefined)?.exact as string || 'camera-a';
  return new Promise<MediaStream>(resolve => media.push({ deviceId, resolve }));
} });
Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () =>
  ['camera-a', 'camera-b'].map(deviceId => ({ kind: 'videoinput', deviceId, label: deviceId })) });
const frameCounts = new WeakMap<HTMLVideoElement, number>();
HTMLMediaElement.prototype.play = async () => {};
HTMLMediaElement.prototype.pause = () => {};
HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
  return window.setTimeout(() => {
    const frames = (frameCounts.get(this) ?? 0) + 1; frameCounts.set(this, frames);
    callback(performance.now(), { presentedFrames: frames, mediaTime: frames / 30 } as VideoFrameCallbackMetadata);
  }, 5);
};
HTMLVideoElement.prototype.cancelVideoFrameCallback = id => window.clearTimeout(id);
function Harness() { latest = useWebcam(error => { notice = error; if (error) errors.push(error); }); return null; }
let root = createRoot(document.getElementById('app')!);
const render = () => root.render(<StrictMode><Harness /></StrictMode>);
render();
Object.assign(window, { webcamHarness: {
  activate: () => latest.activate(),
  enable: (enabled: boolean) => latest.onEnabledChange(enabled),
  choose: (id: string) => latest.onDeviceChange(id),
  close: (id?: string) => latest.close(id),
  unmount: () => root.unmount(),
  remount: () => { root = createRoot(document.getElementById('app')!); render(); },
  command: async (action: CameraCommand['action']) => {
    const id = latest.sessionId()!;
    await Promise.all([...commands].map(callback => callback({ id, action })));
  },
  resolvePrepare: (index: number) => prepares[index].resolve({ id: prepares[index].id }),
  rejectPrepare: (index: number) => {
    if (lease === prepares[index].id) lease = null;
    prepares[index].reject(new Error('模拟摄像头连接失败'));
  },
  resolveMedia: (index: number) => {
    const item = media[index], track = new Track(item.deviceId); item.track = track;
    item.resolve(Object.assign(new MediaStream(), { getTracks: () => [track], getVideoTracks: () => [track] }) as unknown as MediaStream);
  },
  state: () => ({ ready: Boolean(latest), prepares: prepares.length, media: media.length, lease, cancels, errors,
    tracks: media.map(item => item.track?.readyState ?? 'pending'), enabled: latest?.enabled, loading: latest?.loading,
    phase: latest?.phase, hasStream: Boolean(latest?.stream), error: latest?.error, session: latest?.sessionId(),
    selected: latest?.selectedDeviceId, cameraPreference: readAppPreferences().recording.cameraEnabled, notice, listeners: commands.size }),
} });
