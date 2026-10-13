import { createRoot } from 'react-dom/client';
import { RecorderLauncher } from '../src/components/recorder-launcher/RecorderLauncher';
import { updateAppPreferences } from '../src/services/app-preferences';
import { saveRecordingDevicePreference } from '../src/services/recording-device-preferences';
import type { CaptureSource, MicrophoneDevice, RecorderApi, RecordingOptions, RecordingState } from '../shared/types';
import type { LiveApi, LiveState } from '../shared/live-types';

function channel<T>() {
  const callbacks = new Set<(value: T) => void>();
  return { subscribe: (callback: (value: T) => void) => { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
    emit: (value: T) => callbacks.forEach(callback => callback(value)) };
}
const recordingState = channel<RecordingState>(), liveState = channel<LiveState>(), activation = channel<void>();
const noop = () => () => {};
const forbidden = async () => { throw new Error('Physical capture is disabled in this fixture'); };
const devices: MicrophoneDevice[] = [{ id: 'synthetic-mic', name: '测试麦克风', isDefault: true }];
let microphones = devices, microphoneError = '', microphoneRequests = 0, sourceRequests = 0;
let hold = false, pending: (() => void)[] = [];
let sources: CaptureSource[] = [{ id: 'screen:synthetic', kind: 'screen', name: '测试屏幕', width: 1280, height: 720 }];
const starts: RecordingOptions[] = [];
Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [] });
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: forbidden });
localStorage.clear();
updateAppPreferences({ recording: { cameraEnabled: false, microphoneEnabled: true, systemAudio: true } });
saveRecordingDevicePreference('microphone', new URLSearchParams(location.search).get('device') ?? '');
window.recorder = {
  getStatus: async () => ({ nativeAvailable: true, ffmpegAvailable: true, platform: 'win32', version: 'synthetic' }),
  getSources: async () => { sourceRequests++; return sources; },
  getMicrophones: async () => {
    microphoneRequests++;
    const result = microphones, error = microphoneError;
    if (hold) await new Promise<void>(resolve => { pending.push(resolve); });
    if (error) throw new Error(error);
    return result;
  },
  startRecording: async (options: RecordingOptions) => { starts.push(options); recordingState.emit({ status: 'recording' }); },
  onRecordingState: recordingState.subscribe, onActivate: activation.subscribe,
  onCameraCommand: noop, onCameraPreviewRequest: noop, onCameraEnabledChange: noop, onCameraEffectsChange: noop,
  onCameraPreviewSignal: noop, setExpanded: async () => {}, openEditor: async () => {}, quit: async () => {},
  startMicrophoneTrial: forbidden, cancelMicrophoneTrial: async () => {},
} as unknown as RecorderApi;
window.live = {
  applications: async () => [], status: async () => ({ available: true, installed: true, name: 'Synthetic Camera' }),
  install: forbidden, start: forbidden, pull: forbidden, push: forbidden, hideControls: async () => {},
  stop: async () => { liveState.emit({ status: 'idle' }); }, setExcludedApplications: async () => {},
  onState: liveState.subscribe, onAction: noop,
} satisfies LiveApi;
const fixture = {
  configure: (mode: 'ready' | 'missing' | 'error', held = false) => {
    microphones = mode === 'missing' ? [] : devices;
    microphoneError = mode === 'error' ? '麦克风设备读取失败' : ''; hold = held;
  },
  release: () => { hold = false; const queued = pending; pending = []; queued.forEach(resolve => resolve()); },
  devicechange: () => { navigator.mediaDevices.dispatchEvent(new Event('devicechange')); },
  activate: () => { activation.emit(); },
  sources: (available: boolean) => { sources = available ? [{ id: 'screen:synthetic', kind: 'screen', name: '测试屏幕', width: 1280, height: 720 }] : []; },
  live: (status: LiveState['status']) => { liveState.emit({ status }); },
  recording: (status: RecordingState['status']) => { recordingState.emit({ status }); },
  state: () => ({ microphoneRequests, sourceRequests, pending: pending.length, starts }),
};
Object.assign(window, { launcherSessionFixture: fixture });
createRoot(document.getElementById('root')!).render(<RecorderLauncher />);
