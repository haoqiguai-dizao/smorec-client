import { createRoot } from 'react-dom/client';
import { LauncherPanel } from '../src/components/recorder-launcher/LauncherPanel';
import { LauncherToolbar } from '../src/components/recorder-launcher/LauncherToolbar';
import { DistributionUpdateNotice } from '../src/components/recorder-launcher/DistributionUpdateNotice';
import { LiveAccessories, LiveSettings, LiveStart } from '../src/components/recorder-launcher/LiveControls';
import type { DistributionApi, DistributionSnapshot } from '../shared/distribution-types';
import type { UpdateSnapshot } from '../shared/update-types';
import type { RecorderLauncherModel } from '../src/hooks/useRecorderLauncher';
import type { LiveSessionModel } from '../src/hooks/useLiveSession';
import { emptyStreamProfiles } from './stream-profile-model-fixture';
import '../src/styles/live.css';

let current: DistributionSnapshot = { update: { status: 'idle', currentVersion: '0.9.11' }, telemetry: { consent: 'unselected', enabled: false } };
const listeners = new Set<(snapshot: DistributionSnapshot) => void>(), values: boolean[] = [];
let checks = 0, restarts = 0, downloads = 0, reject = false;
const snapshot = (): DistributionSnapshot => structuredClone(current);
const emit = () => listeners.forEach(listener => listener(snapshot()));
window.distribution = {
  state: async () => snapshot(),
  check: async () => { checks++; },
  restart: async () => { restarts++; },
  openDownload: async () => { downloads++; },
  onChanged: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  setTelemetry: async value => {
    values.push(value);
    if (reject) throw new Error('Synthetic preference denial');
    current = { ...current, telemetry: { consent: value ? 'enabled' : 'disabled', enabled: value } };
    emit(); return snapshot();
  },
} satisfies DistributionApi;
Object.assign(window, { distributionUi: {
  state: () => ({ values, checks, restarts, downloads, telemetry: current.telemetry }),
  update: (value: UpdateSnapshot) => { current = { ...current, update: value }; emit(); },
  reject: (value: boolean) => { reject = value; },
} });
const model = { state: { status: 'idle' }, busy: false, countdown: null, canStart: true, panel: 'more', mode: 'screen',
  microphone: true, systemAudio: true, loadingMicrophones: false, camera: { enabled: true, loading: false, stream: new MediaStream() },
  resolution: '1080p', fps: 30, output: { width: 1920, height: 1080 }, status: { nativeAvailable: true, version: '0.9.11' },
  chooseMode: () => {}, setPanel: () => {}, clearError: () => {}, setMicrophone: () => {}, setSystemAudio: () => {},
  setResolution: () => {}, setFps: () => {}, openEditor: async () => {}, start: async () => {},
} as unknown as RecorderLauncherModel;
const applications = Array.from({ length: 15 }, (_, index) => ({ id: `C:\\Synthetic\\app-${index}.exe`, executable: `app-${index}.exe`,
  name: index === 0 ? '抖音直播伴侣' : index === 1 ? '小红书直播助手' : `示例应用 ${index + 1}`, running: true }));
const live: LiveSessionModel = { output: 'camera', setOutput: () => {}, profiles: emptyStreamProfiles(), state: { status: 'idle' }, active: false, error: undefined, clearError: () => {},
  device: { available: true, installed: true, name: 'Synthetic Camera' }, applications: { choices: applications, selected: applications.slice(0, 2),
    loading: false, applying: false, ready: true, error: undefined, refresh: async () => {}, toggle: async () => {}, includes: id => applications.slice(0, 2).some(app => app.id === id) },
  portrait: false, setPortrait: () => {}, zoomEnabled: true, zoomAvailable: true, action: () => {}, refresh: async () => {},
  previewRef: { current: null }, previewReady: false, previewEnabled: true, togglePreview: () => {}, audioLevel: 0, connecting: false, broadcast: async () => {},
  start: async () => {}, stop: async () => {}, install: async () => {}, installing: false };
const isLive = new URLSearchParams(location.search).has('live');
createRoot(document.getElementById('root')!).render(<main className="recorder-launcher">
  <LauncherToolbar model={model} mode={isLive ? 'live' : 'record'} updateNotice={<DistributionUpdateNotice />} switcher={<select className="launcher-session" aria-label="工作模式" defaultValue={isLive ? 'live' : 'record'}>
    <option value="record">录制</option><option value="live">直播</option></select>}
    primary={isLive ? <LiveStart live={live} canStart start={() => {}} /> : undefined} />
  <LauncherPanel model={model} settings={isLive ? <><LiveSettings live={live} /><LiveAccessories live={live} applicationsOpen={false} onApplications={() => {}} /></> : undefined} />
</main>);
