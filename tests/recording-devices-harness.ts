import './launcher-session-ui-harness';
import type { LiveRecordingState, RecordingControlAction, RecordingOverlayApi, CameraCommand } from '../shared/types';
import { ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';

let state: LiveRecordingState = { status: 'idle', cameraAvailable: false, cameraVisible: false, cameraShape: 'rounded', cameraSize: .3,
  cameraMirror: false, cameraEffects: { ...ORIGINAL_CAMERA_EFFECTS }, cameraZoom: 1, microphoneEnabled: true, microphoneMuted: false,
  microphoneDeviceId: 'mic-a', microphoneName: '测试麦克风 A', systemAudioEnabled: false, systemAudioMuted: false, elapsed: 12 };
const output = document.getElementById('device-result')!, calls: unknown[] = [];
const listeners = new Set<(value: LiveRecordingState) => void>();
let cameraCommand: (command: CameraCommand) => void = () => {}, started: (() => void) | undefined;
const publish = () => { listeners.forEach(callback => callback({ ...state })); output.dataset.state = JSON.stringify({ state, calls }); };
const rawSources: { stream: MediaStream; timer: ReturnType<typeof setInterval> }[] = [];
Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { configurable: true, value: async () => [
  { kind: 'videoinput', deviceId: 'camera-a', label: '测试摄像头 A' }, { kind: 'videoinput', deviceId: 'camera-b', label: '测试摄像头 B' },
  { kind: 'videoinput', deviceId: 'camera-missing', label: '断开的摄像头' },
] });
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async (constraints: MediaStreamConstraints) => {
  const id = ((constraints.video as MediaTrackConstraints).deviceId as ConstrainDOMStringParameters)?.exact as string || 'camera-a';
  if (id === 'camera-missing') throw new DOMException('所选摄像头已断开', 'NotFoundError');
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d')!; let n = 0;
  const paint = () => { ctx.fillStyle = id === 'camera-a' ? '#245a94' : '#258855'; ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = 'white'; ctx.fillRect(n++ % 100, 10, 20, 20); };
  paint(); const stream = canvas.captureStream(30), track = stream.getVideoTracks()[0], read = track.getSettings.bind(track);
  Object.defineProperty(track, 'getSettings', { value: () => ({ ...read(), deviceId: id }) });
  const timer = setInterval(paint, 33); rawSources.push({ stream, timer }); return stream;
} });
Object.assign(window.recorder!, {
  getStatus: async () => ({ nativeAvailable: true, ffmpegAvailable: true, platform: 'darwin', version: 'synthetic' }),
  getMicrophones: async () => [{ id: 'mic-a', name: '测试麦克风 A', isDefault: true }, { id: 'mic-b', name: '测试麦克风 B', isDefault: false }, { id: 'missing', name: '断开的麦克风', isDefault: false }],
  cameraPrepare: async () => ({ id: 'fixture-camera' }),
  onCameraCommand: (callback: typeof cameraCommand) => { cameraCommand = callback; return () => {}; },
  cameraPreviewReady: async () => {}, cameraPreviewClosed: async () => {}, cameraStarted: async () => { started?.(); }, cameraAppend: async () => {},
  cameraFinish: async () => {}, cameraCancel: async () => {}, cameraFrameStall: async () => {}, cameraFrameResumed: async () => {},
  attachRecordingCamera: async (id: string) => {
    const ready = new Promise<void>(resolve => { started = resolve; });
    cameraCommand({ action: 'start', id }); await ready;
    state = { ...state, cameraAvailable: true, cameraVisible: true, cameraSessionId: id }; publish();
  },
});
window.recordingOverlay = {
  getState: async () => state, onState: callback => { listeners.add(callback); return () => listeners.delete(callback); },
  control: async (action: RecordingControlAction) => {
    calls.push(action);
    if (action.type === 'microphone-source') {
      if (action.value.deviceId === 'missing') throw new Error('麦克风切换失败，原设备保持');
      state = { ...state, microphoneDeviceId: action.value.deviceId, microphoneEnabled: action.value.enabled, microphoneMuted: !action.value.enabled };
    }
    if (action.type === 'camera-mirror') state = { ...state, cameraMirror: action.value };
    if (action.type === 'camera-effects') state = { ...state, cameraEffects: { ...state.cameraEffects!, ...action.value } };
    if (action.type === 'camera-visible') state = { ...state, cameraVisible: action.value };
    if (action.type === 'microphone-muted') state = { ...state, microphoneMuted: action.value };
    publish();
  },
  setExpanded: async () => {}, setCameraSettings: async () => {}, previewReady: async () => ({ sessionId: 'fixture-viewer' }),
  sendPreviewSignal: async () => {}, onPreviewSignal: () => () => {},
} satisfies RecordingOverlayApi;
document.getElementById('begin')!.onclick = () => {
  (window as unknown as { launcherSessionFixture: { recording(status: string): void } }).launcherSessionFixture.recording('recording');
  state = { ...state, status: 'recording' }; publish(); output.textContent = '录中设备交互验收';
};
window.addEventListener('pagehide', () => rawSources.forEach(source => { clearInterval(source.timer); source.stream.getTracks().forEach(track => track.stop()); }));
