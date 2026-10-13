import { ChevronDown, ChevronUp, Circle, LoaderCircle, MoreHorizontal, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { SessionDevices } from '../session-controls/SessionDevices';
import { SessionWhiteboard } from '../session-controls/SessionWhiteboard';
import { ToolbarFrame } from '../session-controls/ToolbarFrame';
import type { SessionDevices as Devices } from '../session-controls/types';
import { LauncherPictureControls } from './LauncherPictureControls';
import { LauncherSourceTrigger } from './LauncherSourceTrigger';
import type { ToolbarExclusionControl } from '../session-controls/types';
import './preparation-toolbar.css';
import { ToolbarQuitButton } from '../session-controls/ToolbarQuitButton';

export function LauncherToolbar({ model: m, mode = 'record', switcher, primary, updateNotice, exclusion }: {
  model: RecorderLauncherModel; mode?: 'record' | 'live'; switcher?: ReactNode;
  primary?: ReactNode; updateNotice?: ReactNode;
  exclusion?: ToolbarExclusionControl;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const compact = collapsed && !m.panel && !m.error && !m.busy;
  const devices: Devices = {
    camera: { enabled: m.camera.enabled, disabled: m.busy, pending: m.camera.loading, allowToggleWhilePending: true,
      ready: !!m.camera.stream && !m.camera.error && !m.camera.loading,
      toggle: () => { m.camera.onEnabledChange(!m.camera.enabled); m.setPanel(m.camera.enabled ? null : 'camera'); },
      settings: { label: '选择摄像头', open: m.panel === 'camera', disabled: m.busy,
        toggle: () => m.setPanel(m.panel === 'camera' ? null : 'camera') } },
    microphone: { enabled: m.microphone, disabled: m.busy,
      ready: !m.loadingMicrophones && !m.microphoneError && !!m.microphones?.length,
      toggle: () => { m.setMicrophone(!m.microphone); m.setPanel(m.microphone ? null : 'microphone'); },
      settings: { label: '选择麦克风', open: m.panel === 'microphone', disabled: m.busy,
        toggle: () => m.setPanel(m.panel === 'microphone' ? null : 'microphone') } },
    system: { enabled: m.systemAudio, disabled: m.busy, toggle: () => m.setSystemAudio(!m.systemAudio) },
  };
  return <ToolbarFrame mode={mode} preparation compact={compact} notice={updateNotice} context={
    <div className="toolbar-mode-context">
      {compact || !switcher ? <strong>{mode === 'record' ? '录屏' : '直播'}</strong> : switcher}
    </div>}>
    {exclusion ? <LauncherPictureControls model={m} exclusion={exclusion} compact={compact} />
      : !compact && <div className="toolbar-picture"><LauncherSourceTrigger model={m} /></div>}
    <SessionDevices devices={devices} compact={compact} />
    <SessionWhiteboard compact={compact} />
    {!compact &&
      <button type="button" className="session-more" aria-label="更多设置" aria-expanded={m.panel === 'more'} disabled={m.busy}
        title="更多设置" onClick={() => m.setPanel(m.panel === 'more' ? null : 'more')}><MoreHorizontal size={21} /></button>}
    <div className="session-actions">
      {!compact && (primary ?? <button type="button" className={`launcher-start ${m.countdown !== null ? 'counting' : ''}`}
        aria-busy={m.state.status === 'starting'} disabled={m.countdown === null && !m.canStart && !m.canConfigureMicrophone && !m.canConfigurePermissions}
        title={m.canConfigurePermissions ? '点击检查当前任务所需权限' : m.canConfigureMicrophone ? '麦克风暂不可用，点击检查或关闭麦克风' : undefined}
        onClick={() => m.countdown !== null ? m.cancelCountdown() : void m.start()} aria-label={m.countdown !== null ? '取消倒计时' : '开始录制'}>
        {m.countdown !== null ? <><strong>{m.countdown}</strong><span>取消</span><X size={13} /></>
          : m.state.status === 'starting' ? <><LoaderCircle size={15} className="launcher-spinning" /><span>准备中</span></>
          : <><Circle className="launcher-record-dot" size={8} fill="currentColor" strokeWidth={0} /><span>开始录制</span></>}
      </button>)}
    <ToolbarQuitButton disabled={m.countdown !== null || m.state.status === 'starting'} />
    <button type="button" className="session-collapse" aria-label={compact ? '展开操作栏' : '收起操作栏'} disabled={m.busy}
      onClick={() => { m.setPanel(null); setCollapsed(!compact); }}>
      {compact ? <ChevronUp size={17} /> : <ChevronDown size={17} />}<span>{compact ? '展开' : '收起'}</span>
    </button>
    </div>
  </ToolbarFrame>;
}
