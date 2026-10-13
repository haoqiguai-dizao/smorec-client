import { AlertCircle, RefreshCw, X } from 'lucide-react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { LauncherCameraPanel } from './LauncherCameraPanel';
import { LauncherMicrophonePanel } from './LauncherMicrophonePanel';
import { LauncherSources } from './LauncherSources';
import { LauncherRecordingSettings } from './LauncherRecordingSettings';
import type { ReactNode } from 'react';
import { DistributionSettings } from './DistributionSettings';
import { MacPermissionSettings } from './MacPermissionSettings';
import './mac-permissions.css';
import { useLauncherPanelDrag } from '../../hooks/useLauncherPanelDrag';
import { LauncherCameraRecovery } from './LauncherCameraRecovery';
import { AudioCacheSettings } from './AudioCacheSettings';
import { PermissionGuide } from './PermissionGuide';
import { CaptureRecoveryPanel } from './CaptureRecoveryPanel';

const titles = { mode: '工作模式', sources: '录制范围', camera: '摄像头', microphone: '麦克风', more: '设置', applications: '排除应用', permissions: '授权引导' };

export function LauncherPanel({ model: m, settings, applications, applicationsHeader = false, modeMenu, settingsTitle, settingsOnly = false, actions }: { model: RecorderLauncherModel; settings?: ReactNode; applications?: ReactNode; applicationsHeader?: boolean; modeMenu?: ReactNode; settingsTitle?: string; settingsOnly?: boolean; actions?: ReactNode }) {
  const drag = useLauncherPanelDrag();
  if (m.panel === 'mode') return modeMenu;
  if (!m.busy && m.permissions?.enabled && m.panel === 'permissions') {
    return <PermissionGuide model={m} mode={settingsOnly ? 'live' : 'record'} />;
  }
  if (!m.panel && !m.error) return null;
  const refresh = m.panel === 'sources' ? () => void m.refreshSources() : m.panel === 'camera' ? m.camera.onRefresh : m.panel === 'microphone' ? () => void m.refreshMicrophones() : undefined;
  const loading = m.panel === 'sources' ? m.loadingSources : m.panel === 'camera' ? false : m.loadingMicrophones;
  const cameraError = m.cameraErrorVisible || !!m.camera.error && m.error === m.camera.error;
  if (!m.busy && cameraError && m.error && m.panel !== 'camera') {
    return <CaptureRecoveryPanel label="设备恢复" close={() => { m.setPanel(null); m.clearError(); }}>
      <LauncherCameraRecovery model={m} message={m.error} />
    </CaptureRecoveryPanel>;
  }
  return <section className={`launcher-panel launcher-panel-${m.panel || 'notice'}${settingsOnly && m.panel === 'more' ? ' launcher-live-panel' : ''}`} {...drag} data-toolbar-surface aria-label={m.panel === 'more' && settingsTitle ? settingsTitle : m.panel ? titles[m.panel] : '录制提示'}>
    {!(m.panel === 'applications' && applicationsHeader) && <header className="launcher-panel-header"><h1>{m.panel === 'more' && settingsTitle ? settingsTitle : m.panel ? titles[m.panel] : '录制提示'}</h1>
      {refresh && <button className="launcher-icon" title="刷新设备" aria-label="刷新设备" disabled={m.busy || loading} onClick={refresh}><RefreshCw size={15} className={loading ? 'launcher-spinning' : ''} /></button>}
      <button className="launcher-icon" aria-label="收起设置" onClick={() => { m.setPanel(null); m.clearError(); }}><X size={17} /></button>
    </header>}
    <div className="launcher-panel-content">{m.panel === 'sources' && <LauncherSources model={m} closeOnSelect={!settingsOnly} />}{m.panel === 'camera' && <LauncherCameraPanel model={m} />}{m.panel === 'microphone' && <LauncherMicrophonePanel model={m} />}{m.panel === 'more' && <>{actions && <div className="launcher-secondary-actions">{actions}</div>}{settings ?? <LauncherRecordingSettings model={m} />}</>}
      {m.panel === 'applications' && applications}
      {settingsOnly && m.panel && m.panel !== 'more' && m.panel !== 'applications' && <footer className="live-workflow-footer"><button className="launcher-start" onClick={() => m.setPanel('more')}>返回直播准备</button></footer>}
      {m.panel === 'more' && !settingsOnly && <DistributionSettings />}
      {m.panel === 'more' && !settingsOnly && <AudioCacheSettings />}
      {m.status?.platform === 'darwin' && (m.panel === 'more' || m.error && !cameraError) && <MacPermissionSettings disabled={m.busy} permissions={m.permissions}
        onGuide={kind => { m.permissions.openGuide(kind); m.setPanel('permissions'); }} />}
      {m.error && !(m.panel === 'camera' && cameraError) && (cameraError
        ? <LauncherCameraRecovery model={m} message={m.error} />
        : <div className="launcher-inline-error" role="alert"><AlertCircle size={15} />{m.error}</div>)}
      {m.status && !m.status.nativeAvailable && <div className="launcher-inline-error" role="alert"><AlertCircle size={15} />录制引擎未就绪，请重新安装小录</div>}
    </div>
  </section>;
}
