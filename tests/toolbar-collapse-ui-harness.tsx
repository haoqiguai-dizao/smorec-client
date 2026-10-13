import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useToolbarAutoCollapse } from '../src/hooks/useToolbarAutoCollapse';
import { RecordingToolbar } from '../src/components/recording-overlay/RecordingToolbar';
import { LauncherToolbar } from '../src/components/recorder-launcher/LauncherToolbar';
import { LauncherPanel } from '../src/components/recorder-launcher/LauncherPanel';
import { LiveApplicationSettings } from '../src/components/recorder-launcher/LiveApplicationSettings';
import { LiveSettings, LiveStart } from '../src/components/recorder-launcher/LiveControls';
import { SessionToolbar } from '../src/components/session-controls/SessionToolbar';
import { useLiveApplications } from '../src/hooks/useLiveApplications';
import type { LiveSessionModel } from '../src/hooks/useLiveSession';
import { emptyStreamProfiles } from './stream-profile-model-fixture';
import type { LiveApplication, LiveApi } from '../shared/live-types';
import type { RecorderLauncherModel } from '../src/hooks/useRecorderLauncher';
import type { LiveRecordingState, RecordingOverlayApi } from '../shared/types';
import type { ToolbarRegion } from '../shared/toolbar-types';
import '../src/styles/live.css';

let stops = 0, regions: ToolbarRegion[] | null = null;
let hold: (value: boolean) => void = () => {};
let setActive: (value: boolean) => void = () => {}, setSettings: (value: boolean) => void = () => {};
let cameraOpens = 0, selected: string[] = [], ready = false;
const fakeApplications: LiveApplication[] = [
  { id: 'C:\\Fake\\Douyin\\直播伴侣.exe', name: '抖音直播伴侣', executable: '直播伴侣.exe' },
  { id: 'C:\\Fake\\Xhs\\xhs-live-helper.exe', name: '小红书直播助手', executable: 'xhs-live-helper.exe' },
  { id: 'C:\\Fake\\Browser\\browser.exe', name: '浏览器', executable: 'browser.exe' },
  { id: 'C:\\Fake\\OBS\\obs.exe', name: 'OBS', executable: 'obs.exe' },
  ...Array.from({ length: 14 }, (_, index) => ({ id: `C:\\Fake\\App${index}.exe`,
    name: `应用 ${index + 1} 的较长名称用于核实横向截断不会挤出窗口边界`, executable: `App${index}.exe` })),
];
let availableApplications = fakeApplications;
let rejectUpdate = false, updates = 0;
let applied: string[] = [];
localStorage.clear();
window.live = {
  applications: async () => availableApplications,
  status: async () => ({ available: true, installed: true, name: 'Synthetic Camera' }),
  install: async () => { throw new Error('Synthetic test must never install'); },
  setExcludedApplications: async (_id, applications) => {
    updates++;
    await new Promise(resolve => setTimeout(resolve, 80));
    if (rejectUpdate) throw new Error('Synthetic exclusion update failed');
    applied = applications;
  },
  start: async () => { throw new Error('Synthetic test must never record'); },
  pull: async () => { throw new Error('Synthetic test must never capture'); },
  push: async () => { throw new Error('Synthetic test must never publish'); },
  stop: async () => {}, hideControls: async () => {},
  onState: () => () => {}, onAction: () => () => {},
} satisfies LiveApi;
let patchRecording: (state: LiveRecordingState) => void = () => {};
let recording: LiveRecordingState = { status: 'recording', cameraAvailable: true, cameraVisible: true, cameraShape: 'circle',
  cameraSize: .22, cameraMirror: true, microphoneEnabled: true, microphoneMuted: false, microphoneName: '',
  systemAudioEnabled: true, systemAudioMuted: false, elapsed: 12 };
window.toolbarPresentation = { setRegions: async value => { regions = value; } };
window.recordingOverlay = {
  getState: async () => recording,
  onState: callback => { patchRecording = callback; return () => {}; },
  control: async action => { if (action.type === 'stop') stops++; },
  setExpanded: async () => {},
  setCameraSettings: async () => {},
  previewReady: async () => ({ sessionId: 'synthetic-toolbar-only' }),
  sendPreviewSignal: async () => {},
  onPreviewSignal: () => () => {},
} satisfies RecordingOverlayApi;
function Harness() {
  const [pinned, setPinned] = useState(false); hold = setPinned;
  const [active, updateActive] = useState(false); setActive = updateActive;
  const [panel, setPanel] = useState<'more' | 'applications' | null>(null); setSettings = value => setPanel(value ? 'more' : null);
  const applications = useLiveApplications(false, async selected => { if (active) await window.live!.setExcludedApplications('synthetic', selected.map(app => app.id)); }); selected = applications.selected.map(application => application.name); ready = applications.ready;
  const collapse = useToolbarAutoCollapse({ enabled: active, keepExpanded: pinned || !!panel });
  const model = { state: { status: 'idle' }, busy: active, countdown: null, canStart: true, panel, mode: 'screen',
    microphone: true, systemAudio: true, loadingMicrophones: false, camera: { enabled: true, loading: false, stream: new MediaStream() },
    chooseMode: () => {}, setPanel, clearError: () => {}, setMicrophone: () => {}, setSystemAudio: () => {},
  } as unknown as RecorderLauncherModel;
  const live: LiveSessionModel = { output: 'camera', setOutput: () => {}, profiles: emptyStreamProfiles(), state: { status: active ? 'live' : 'idle', cameraSettingsOpen: pinned }, active, applications,
    device: { available: true, installed: true, name: 'Synthetic Camera' }, error: undefined, clearError: () => {},
    portrait: false, setPortrait: () => {}, zoomEnabled: true, zoomAvailable: true, action: () => {}, refresh: async () => {},
    previewRef: { current: null }, previewReady: false, previewEnabled: true, togglePreview: () => {}, audioLevel: 0, connecting: false, broadcast: async () => {},
    start: async () => updateActive(true), stop: async () => { stops++; }, install: async () => {}, installing: false };
  const liveCameraSettings = active ? { disabled: false, opening: false, open: async () => { cameraOpens++; setPinned(true); setPanel(null); } } : undefined;
  return <main className="recorder-launcher" ref={collapse.containerRef} {...collapse.interactionProps}>
    {active ? <SessionToolbar mode="live" label="输出中" time="00:12" compact={collapse.collapsed} collapse={collapse.collapse} expand={collapse.expand}
        tools={() => setPanel(panel === 'more' ? null : 'more')} toolsOpen={!!panel} stop={() => stops++} stopLabel="停止输出"
        devices={{ camera: { enabled: true, toggle: () => void liveCameraSettings?.open() },
          microphone: { enabled: true, disabled: true, toggle: () => {} }, system: { enabled: true, disabled: true, toggle: () => {} } }} />
      : <LauncherToolbar model={model} mode="live"
        switcher={<select className="launcher-session" aria-label="工作模式" disabled={active} defaultValue="live"><option value="record">录制</option><option value="live">直播</option></select>}
        primary={<LiveStart live={live} canStart start={() => updateActive(true)} />} />}
    <LauncherPanel model={model} applications={<LiveApplicationSettings applications={applications} disabled={false} />} settings={<LiveSettings live={live} />} />
  </main>;
}
const launcher = new URLSearchParams(location.search).has('launcher');
Object.assign(window, { toolbarUi: {
  state: () => ({ stops, regions, cameraOpens, selected, ready, applied, updates }),
  reject: (value: boolean) => { rejectUpdate = value; },
  active: (value: boolean) => setActive(value),
  settings: (value: boolean) => setSettings(value),
  exitObs: () => { availableApplications = fakeApplications.filter(application => application.name !== 'OBS'); },
  pin: (value: boolean) => {
    if (launcher) hold(value);
    else { recording = { ...recording, cameraPanel: value ? {
      camera: { x: 0, y: 0, width: 232, height: 232 }, settings: { x: 240, y: 0, width: 300, height: 360 },
    } : undefined }; patchRecording(recording); }
  },
} });
createRoot(document.getElementById('root')!).render(launcher ? <Harness /> : <RecordingToolbar />);
