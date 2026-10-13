import { createRoot } from 'react-dom/client';
import { RecorderLauncher } from '../src/components/recorder-launcher/RecorderLauncher';
import { updateAppPreferences } from '../src/services/app-preferences';
import type { MacPermission, PermissionStatus } from '../shared/platform-permissions';
import type { RecorderApi } from '../shared/types';
import type { LiveApi } from '../shared/live-types';
import '../src/styles/recorder-launcher.css';
import '../src/styles/capture-theme.css';
import './session-controls-ui-harness.css';

const none = () => () => {};
let revision = 0, requests = 0, settings = 0, starts = 0, cameraTries = 0, drags = 0, reveals = 0;
let statuses: PermissionStatus[] = [], fail = false;
const root = createRoot(document.getElementById('root')!);
const denied = (kind: MacPermission): PermissionStatus => ({ kind, granted: false, access: 'denied' });
const permitted = (kind: MacPermission): PermissionStatus => ({ kind, granted: true, access: 'granted' });
window.platformPermissions = {
  get: async () => { if (fail) throw new Error('权限服务暂时不可用'); return statuses.map(item => ({ ...item })); },
  request: async () => { requests++; receipt(); },
  openSettings: async () => { settings++; receipt(); },
  cameraStatus: async () => ({ availableCount: 0, suspendedCount: 1, builtInSuspended: true }),
  components: async kind => kind === 'screen' ? [{ id: 'application', name: '小录', role: '主应用' }, { id: 'capture', name: '小录', role: '录制组件' }]
    : [{ id: kind === 'camera' ? 'application' : 'capture', name: '小录', role: kind === 'camera' ? '主应用' : '录制组件' }],
  dragComponent: () => { drags++; receipt(); },
  revealComponent: async () => { reveals++; receipt(); },
};
Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
  cameraTries++;
  receipt();
  throw new DOMException('fixture camera suspended', 'NotFoundError');
} });
window.recorder = {
  getStatus: async () => ({ nativeAvailable: true, ffmpegAvailable: true, platform: 'darwin', version: 'fixture' }),
  getSources: async () => {
    if (!statuses.some(item => item.kind === 'screen' && item.granted)) throw new Error('请允许屏幕录制权限');
    return [{ id: 'screen:fixture', kind: 'screen', name: '主屏幕', width: 1920, height: 1080 }];
  },
  getMicrophones: async () => [{ id: 'mic:fixture', name: '测试麦克风', isDefault: true }],
  onRecordingState: none, onActivate: (callback: () => void) => { setTimeout(callback, 10); return () => {}; }, onCameraCommand: none,
  onCameraPreviewRequest: none, onCameraEnabledChange: none, onCameraEffectsChange: none, onCameraPreviewSignal: none,
  setExpanded: async () => {}, openEditor: async () => {}, quit: () => {}, openCameraSettings: async () => {},
  cameraPrepare: async () => ({ id: crypto.randomUUID() }), cameraCancel: async () => {},
  startRecording: async () => { starts++; receipt(); },
  setExcludedApplications: async () => {},
} as unknown as RecorderApi;
window.live = {
  applications: async () => [], status: async () => ({ available: true, installed: true, name: '小录 Virtual Camera' }),
  install: async () => {}, start: async () => { starts++; receipt(); throw new Error('fixture disallows actual output'); },
  pull: async () => { throw new Error('fixture'); }, push: async () => {}, hideControls: async () => {},
  stop: async () => {}, onState: none, onAction: none,
} as unknown as LiveApi;
window.whiteboard = { snapshot: async () => ({ available: false, visible: false, events: [] }), onState: none } as unknown as typeof window.whiteboard;
const controls = document.getElementById('fixture-controls')!;
controls.innerHTML = '<span>受控权限 · 无系统授权／采集</span><button id="screen">缺屏幕权限</button><button id="mic">缺麦克风权限</button><button id="camera">摄像头暂停</button><button id="input">缺操作权限</button><button id="optional">仅缺未启用权限</button><button id="grant">允许当前权限</button><button id="read-fail">读取失败</button><output id="receipt"></output>';
function receipt() { controls.querySelector('#receipt')!.textContent = `授权请求 ${requests} · 设置 ${settings} · 开始 ${starts} · 相机重试 ${cameraTries} · 拖拽 ${drags} · 定位 ${reveals}`; }
function mount(state: 'screen' | 'mic' | 'camera' | 'input' | 'optional') {
  fail = false;
  statuses = [state === 'screen' ? denied('screen') : permitted('screen'), permitted('camera'),
    state === 'mic' ? { ...denied('microphone'), access: 'not-determined' } : permitted('microphone'), denied('input'), denied('accessibility')];
  updateAppPreferences({ recording: { cameraEnabled: state === 'camera', microphoneEnabled: state !== 'screen', systemAudio: true, inputRecording: state === 'input' } });
  root.render(<RecorderLauncher key={++revision} />);
  receipt();
}
controls.querySelector('#screen')!.addEventListener('click', () => mount('screen'));
controls.querySelector('#mic')!.addEventListener('click', () => mount('mic'));
controls.querySelector('#camera')!.addEventListener('click', () => mount('camera'));
controls.querySelector('#input')!.addEventListener('click', () => mount('input'));
controls.querySelector('#optional')!.addEventListener('click', () => mount('optional'));
controls.querySelector('#grant')!.addEventListener('click', () => {
  fail = false; statuses = statuses.map(item => permitted(item.kind));
  window.dispatchEvent(new Event('focus')); receipt();
});
controls.querySelector('#read-fail')!.addEventListener('click', () => { fail = true; window.dispatchEvent(new Event('focus')); });
mount('screen');
