import { useLauncherSession } from '../../hooks/useLauncherSession';
import { useToolbarAutoCollapse } from '../../hooks/useToolbarAutoCollapse';
import { SessionToolbar } from '../session-controls/SessionToolbar';
import { LauncherPanel } from './LauncherPanel';
import { LauncherToolbar } from './LauncherToolbar';
import { DistributionUpdateNotice } from './DistributionUpdateNotice';
import { LiveApplicationSettings } from './LiveApplicationSettings';
import { LiveAccessories, LiveStart } from './LiveControls';
import { LiveWorkflow } from './LiveWorkflow';
import '../../styles/live.css';
import './recording-session.css';
import { useLauncherRecordingControls } from '../../hooks/useLauncherRecordingControls';
import { RecordingSessionMenu } from './RecordingSessionMenu';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionControls } from '../../hooks/useSessionControls';
import { useToolbarApplications } from '../../hooks/useToolbarApplications';
import { LauncherModeMenu } from './LauncherModeMenu';
import { LauncherPictureControls } from './LauncherPictureControls';
import { SessionQuitAction } from '../session-controls/SessionQuitAction';
import { RecordingSessionDevicePanel } from './RecordingSessionDevicePanel';

export function RecorderLauncher() {
  const { model, mode, chooseMode, live, canStart, start, liveCameraSettings, liveStep, setLiveStep } = useLauncherSession();
  const recording = useLauncherRecordingControls(model.state.status);
  const controls = useSessionControls(model, live, recording);
  const autoHiddenSession = useRef<string | undefined>(undefined);
  const [boardBusy, setBoardBusy] = useState(false);
  const running = mode === 'record' && recording.running;
  const closeMode = useCallback(() => model.setPanel(null), [model.setPanel]);
  const switcher = <button type="button" className="toolbar-mode-trigger" aria-label="工作模式" aria-haspopup="menu"
    aria-expanded={model.panel === 'mode'} data-toolbar-focus="mode" disabled={model.busy}
    onClick={() => model.setPanel(model.panel === 'mode' ? null : 'mode')}>
    <span>{mode === 'record' ? '录屏' : '直播'}</span><ChevronDown size={13} /></button>;
  const collapse = useToolbarAutoCollapse({ enabled: running && model.state.status === 'recording' || mode === 'live' && live.state.status === 'live' && live.state.phase !== 'preview',
    keepExpanded: !!model.panel || !!model.error || !!liveCameraSettings?.opening || !!live.state.cameraSettingsOpen || boardBusy
      || running && (recording.settings.open || recording.settings.busy || recording.stopping || !!recording.error) });
  const exclusion = useToolbarApplications(model, live.applications,
    mode === 'record' ? running ? !recording.active : model.busy : live.installing || ['starting', 'stopping'].includes(live.state.status),
    collapse.collapsed, collapse.collapse);
  useEffect(() => {
    if (mode !== 'live' || live.state.phase !== 'broadcast' || !live.state.id || live.output === 'stream' && live.state.connection?.status !== 'streaming') return;
    if (autoHiddenSession.current === live.state.id) return;
    autoHiddenSession.current = live.state.id;
    model.setPanel(null);
    collapse.collapse();
  }, [mode, live.state.id, live.state.phase, live.state.connection?.status, live.output, model.setPanel, collapse.collapse]);
  const sessionRunning = running || mode === 'live' && ['live', 'stopping'].includes(live.state.status);
  return <main className="recorder-launcher" ref={collapse.containerRef} {...collapse.interactionProps}>
    {sessionRunning ? <SessionToolbar mode={mode} label={controls.label} time={controls.time} devices={controls.devices} compact={collapse.collapsed}
      picture={<LauncherPictureControls model={model} exclusion={exclusion} readOnly compact={collapse.collapsed} />}
      stopLabel={mode === 'live' ? live.state.phase === 'preview' ? '结束预览' : live.output === 'camera' ? '停止输出' : undefined : undefined}
      pending={running ? recording.stopping || model.state.status === 'starting' : live.state.status === 'stopping'} toolsOpen={model.panel === 'more'}
      collapse={() => { model.setPanel(null); collapse.collapse(); }} expand={collapse.expand} tools={() => model.setPanel(model.panel === 'more' ? null : 'more')}
      stop={() => running ? void recording.control({ type: 'stop' }) : void live.stop()} onBoardBusy={setBoardBusy} />
      : <LauncherToolbar model={model} mode={mode} updateNotice={<DistributionUpdateNotice />} switcher={switcher} exclusion={exclusion}
      primary={mode === 'live' ? <LiveStart live={live} canStart={canStart} start={start} step={liveStep} open={() => model.setPanel('more')} /> : undefined} />}
    {running && (model.panel === 'camera' || model.panel === 'microphone') ? <RecordingSessionDevicePanel model={model} recording={recording} />
    : running && model.panel === 'more' ? <RecordingSessionMenu model={model} recording={recording} onBusy={setBoardBusy} close={() => { model.setPanel(null); model.clearError(); }} />
    : <LauncherPanel model={model} applicationsHeader modeMenu={<LauncherModeMenu mode={mode} close={closeMode}
      choose={next => { closeMode(); chooseMode(next); }} />} applications={<LiveApplicationSettings applications={live.applications} recording={mode === 'record'}
      compact close={() => { model.setPanel(null); model.clearError(); }} disabled={!!exclusion.disabled} />} settingsOnly={mode === 'live'} settingsTitle={mode === 'live' ? live.state.status === 'live' ? '直播设置' : '直播准备' : undefined}
      settings={mode === 'live' ? <><LiveWorkflow live={live} model={model} step={liveStep} setStep={setLiveStep} ready={canStart} start={start} cameraSettings={liveCameraSettings} devices={controls.devices} />
        <details className="launcher-live-tools"><summary>更多画面设置</summary><div className="launcher-secondary-actions"><LiveAccessories live={live} includeApplications={false} applicationsOpen={model.panel === 'applications'} onApplications={() => model.setPanel('applications')} /></div></details>
        {sessionRunning && <SessionQuitAction disabled={live.state.status === 'stopping'} />}</> : undefined} />}
    {running && recording.error && model.panel !== 'camera' && model.panel !== 'microphone'
      && <span className="launcher-recording-warning" role="alert" aria-label={recording.error} title={recording.error}><AlertCircle size={15} /></span>}
    {controls.error && <span className="launcher-recording-warning" role="alert" aria-label={controls.error} title={controls.error}><AlertCircle size={15} /></span>}
  </main>;
}
