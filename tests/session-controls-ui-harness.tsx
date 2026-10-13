import { createRoot } from 'react-dom/client';
import { RecorderLauncher } from '../src/components/recorder-launcher/RecorderLauncher';
import { updateAppPreferences } from '../src/services/app-preferences';
import { saveLiveApplicationSelection } from '../src/services/live-application-preferences';
import type { RecorderApi, RecordingState, LiveRecordingState, RecordingControlAction } from '../shared/types';
import type { LiveApi, LiveState } from '../shared/live-types';
import type { BoardSnapshot } from '../shared/whiteboard/types';
import '../src/styles/recorder-launcher.css';
import '../src/styles/capture-theme.css';
import './session-controls-ui-harness.css';

function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return { on: (callback: (value: T) => void) => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    emit: (value: T) => listeners.forEach(callback => callback(value)) };
}
const recording = channel<RecordingState>(), overlay = channel<LiveRecordingState>(), live = channel<LiveState>();
const board = channel<Omit<BoardSnapshot, 'events'>>();
const none = () => () => {};
const forbidden = async () => { throw new Error('本地验证不访问实际采集设备'); };
let streamState: LiveState = { status: 'idle' }, audioFails = false, exclusionsFail = false, stops = 0, quits = 0, applicationUpdates = 0;
const applications = ['浏览器', '聊天应用', '会议工具', '演示文稿'].map((name, index) => ({
  id: `C:\\Fixture\\application-${index}.exe`, executable: `application-${index}.exe`, name,
}));
let appliedExclusions = applications.slice(0, 2).map(application => application.id);
const applyExclusions = async (ids: string[]) => {
  applicationUpdates++;
  await new Promise(resolve => setTimeout(resolve, 800));
  if (exclusionsFail) throw new Error('排除设置更新失败，原设置仍然生效');
  appliedExclusions = ids;
};
let overlayState: LiveRecordingState = { status: 'idle', cameraAvailable: true, cameraVisible: true,
  cameraShape: 'rounded', cameraSize: .22, cameraMirror: true, microphoneEnabled: true, microphoneMuted: false,
  microphoneName: '测试麦克风', systemAudioEnabled: true, systemAudioMuted: false };
let boardState: BoardSnapshot = { session: 'fixture-board', available: false, visible: false, events: [], presentation: 'canvas', interfaceSupported: true };
localStorage.clear();
updateAppPreferences({ recording: { cameraEnabled: false, microphoneEnabled: true, systemAudio: true } });
saveLiveApplicationSelection(applications.slice(0, 2));
Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: forbidden });
window.recorder = {
  getStatus: async () => ({ nativeAvailable: true, ffmpegAvailable: true, platform: 'win32', version: 'fixture' }),
  getSources: async () => [{ id: 'screen:fixture', kind: 'screen', name: '显示器 1', width: 1920, height: 1080 },
    { id: 'window:fixture', kind: 'window', name: '演示文稿窗口', width: 1280, height: 720 }],
  getMicrophones: async () => [{ id: 'mic', name: '测试麦克风', isDefault: true }],
  onRecordingState: recording.on, onActivate: none, onCameraCommand: none, onCameraPreviewRequest: none,
  onCameraEnabledChange: none, onCameraEffectsChange: none, onCameraPreviewSignal: none,
  setExpanded: async () => {}, openEditor: async () => {}, quit: () => { quits++; }, openCameraSettings: async () => {},
  cameraPrepare: forbidden, startRecording: forbidden,
  setExcludedApplications: applyExclusions,
} as unknown as RecorderApi;
window.recordingOverlay = {
  getState: async () => overlayState, onState: overlay.on, setCameraSettings: async () => {},
  control: async (action: RecordingControlAction) => {
    if (action.type === 'stop') { stops++; recording.emit({ status: 'idle' }); overlayState.status = 'idle'; resetBoard(); }
    if (action.type === 'camera-visible') overlayState.cameraVisible = action.value;
    if (action.type === 'microphone-muted') overlayState.microphoneMuted = action.value;
    if (action.type === 'system-muted') overlayState.systemAudioMuted = action.value;
    overlay.emit({ ...overlayState });
  },
} as unknown as typeof window.recordingOverlay;
window.live = {
  applications: async () => applications, status: async () => ({ available: true, installed: true, name: '小录 Virtual Camera' }),
  install: forbidden, start: forbidden, pull: forbidden, push: forbidden, hideControls: async () => {},
  stop: async () => { stops++; streamState = { status: 'idle' }; live.emit(streamState); resetBoard(); },
  setExcludedApplications: async (_id, ids) => applyExclusions(ids), onState: live.on, onAction: none,
  setAudio: async (_id, channel, enabled) => {
    if (audioFails) throw new Error('麦克风设备暂不可用，推流继续');
    const audio = { system: true, microphone: true, ...streamState.audio, [channel]: enabled };
    streamState = { ...streamState, audio }; live.emit(streamState); return audio;
  },
} satisfies LiveApi;
window.whiteboard = {
  snapshot: async () => boardState, onState: board.on,
  setVisible: async visible => { boardState = { ...boardState, visible }; board.emit(boardState); },
} as typeof window.whiteboard;
window.toolbarPresentation = {
  setRegions: async () => {}, quit: async () => { quits++; return true; },
};
const emitBoard = () => { boardState = { ...boardState, available: true }; board.emit(boardState); };
const resetBoard = () => { boardState = { ...boardState, available: false, visible: false }; board.emit(boardState); };
const controls = document.getElementById('fixture-controls')!;
controls.innerHTML = '<span>受控验证 · 无实际采集</span><button id="prepare">准备态</button><button id="record">模拟录屏</button><button id="live">模拟推流</button><button id="failure">声音失败：关</button><button id="exclusion-failure">排除失败：关</button><output id="receipt">停止 0 · 退出 0</output>';
const selectMode = (label: string, complete: () => void) => {
  document.querySelector<HTMLButtonElement>('[data-toolbar-focus=mode]')?.click();
  setTimeout(() => {
    [...document.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')].find(element => element.textContent === label)?.click();
    setTimeout(complete, 100);
  }, 0);
};
controls.querySelector('#prepare')!.addEventListener('click', () => {
  streamState = { status: 'idle' }; live.emit(streamState);
  recording.emit({ status: 'idle' }); overlayState.status = 'idle'; overlay.emit(overlayState); resetBoard();
});
controls.querySelector('#record')!.addEventListener('click', () => {
  streamState = { status: 'idle' }; live.emit(streamState); recording.emit({ status: 'idle' });
  setTimeout(() => selectMode('录屏', () => {
    overlayState = { ...overlayState, status: 'recording', startedAtUnixMs: Date.now() - 754000 };
    overlay.emit(overlayState); recording.emit({ status: 'recording' }); emitBoard();
  }), 200);
});
controls.querySelector('#live')!.addEventListener('click', () => {
  recording.emit({ status: 'idle' }); overlayState.status = 'idle'; overlay.emit(overlayState);
  streamState = { status: 'idle' }; live.emit(streamState);
  setTimeout(() => selectMode('直播', () => {
    streamState = { status: 'live', id: crypto.randomUUID(), phase: 'broadcast', output: 'stream', startedAtUnixMs: Date.now() - 754000,
      audio: { microphone: true, system: true }, connection: { status: 'streaming', attempt: 0, bitrate: 4500, frames: 100, dropped: 0 } };
    live.emit(streamState); emitBoard();
  }), 200);
});
controls.querySelector('#failure')!.addEventListener('click', event => {
  audioFails = !audioFails; (event.currentTarget as HTMLElement).textContent = `声音失败：${audioFails ? '开' : '关'}`;
});
controls.querySelector('#exclusion-failure')!.addEventListener('click', event => {
  exclusionsFail = !exclusionsFail; (event.currentTarget as HTMLElement).textContent = `排除失败：${exclusionsFail ? '开' : '关'}`;
});
setInterval(() => { controls.querySelector('output')!.textContent = `停止 ${stops} · 退出 ${quits} · 排除更新 ${applicationUpdates} · 已应用 ${appliedExclusions.length}`; }, 200);
createRoot(document.getElementById('root')!).render(<RecorderLauncher />);
