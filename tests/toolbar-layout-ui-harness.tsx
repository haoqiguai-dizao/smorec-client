// Production toolbar composition with synthetic actions; never capture or quit the daily application.
import { ChevronDown, Check, Radio } from 'lucide-react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LauncherToolbar } from '../src/components/recorder-launcher/LauncherToolbar';
import { LauncherPictureControls } from '../src/components/recorder-launcher/LauncherPictureControls';
import { SessionToolbar } from '../src/components/session-controls/SessionToolbar';
import type { RecorderLauncherModel } from '../src/hooks/useRecorderLauncher';
import type { WhiteboardApi } from '../shared/whiteboard/types';
import '../src/styles/recorder-launcher.css';
import '../src/styles/capture-theme.css';

let quits = 0;
window.toolbarPresentation = { setRegions: async () => {}, quit: async () => { quits++; document.documentElement.dataset.quits = String(quits); return true; } };
window.whiteboard = { snapshot: async () => ({ session: 'layout-only', available: true, visible: false, events: [] }),
  onState: () => () => {}, setVisible: async () => {} } as unknown as WhiteboardApi;

function Harness() {
  const params = new URLSearchParams(location.search);
  const initialStage = params.get('stage') ?? 'ready';
  const [stage, setStage] = useState(initialStage), [compact, setCompact] = useState(false);
  const [panel, setPanel] = useState<RecorderLauncherModel['panel']>(null);
  const live = stage.startsWith('live'), running = stage === 'recording' || stage === 'live-preview' || stage === 'live-broadcast';
  const countdown = stage === 'countdown' ? 3 : null;
  const source = { id: 'source:fixture', kind: params.has('long') ? 'window' as const : 'screen' as const,
    name: '演示文稿的较长窗口名称用于验证省略后不会挤出工具栏', width: 1920, height: 1080 };
  const model = { state: { status: running ? 'recording' : 'idle' }, busy: running || countdown !== null, countdown,
    canStart: true, panel, mode: source.kind, selected: source, sources: [source], microphone: true, systemAudio: true,
    loadingMicrophones: false, microphones: [{ id: 'fake', name: '测试麦克风' }], camera: { enabled: true, loading: false, stream: new MediaStream(), onEnabledChange: () => {} },
    setPanel, setMicrophone: () => {}, setSystemAudio: () => {}, cancelCountdown: () => setStage('ready'), start: async () => setStage('recording'),
  } as unknown as RecorderLauncherModel;
  const exclusions = { open: panel === 'applications', title: '排除 4 个应用', count: 4, toggle: () => setPanel(panel ? null : 'applications') };
  const devices = { camera: { enabled: true, toggle: () => {}, settings: { label: '选择摄像头', toggle: () => {} } },
    microphone: { enabled: true, toggle: () => {}, settings: { label: '选择麦克风', toggle: () => {} } }, system: { enabled: true, toggle: () => {} } };
  return <main className="recorder-launcher" data-stage={stage}>
    {running ? <SessionToolbar mode={live ? 'live' : 'record'} label={live ? '推流中' : '录制中'} time="00:12" devices={devices}
      picture={<LauncherPictureControls model={model} exclusion={exclusions} readOnly compact={compact} />} compact={compact}
      collapse={() => setCompact(true)} expand={() => setCompact(false)} tools={() => setPanel('more')}
      stop={() => setStage(live ? 'live-ready' : 'ready')} stopLabel={stage === 'live-preview' ? '结束预览' : undefined} />
      : <LauncherToolbar model={model} mode={live ? 'live' : 'record'} exclusion={exclusions}
      updateNotice={params.has('update') ? <button className="launcher-update-notice" aria-label="重启并更新"><Check size={15} /></button> : undefined}
      switcher={<button className="toolbar-mode-trigger" aria-label="工作模式"><span>{live ? '直播' : '录屏'}</span><ChevronDown size={13} /></button>}
      primary={live ? <button className="launcher-start" onClick={() => setStage('live-preview')}><Radio size={15} /><span>准备直播</span></button> : undefined} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
