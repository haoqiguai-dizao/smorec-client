import { LoaderCircle, Square } from 'lucide-react';
import type { LauncherRecordingControls } from '../../hooks/useLauncherRecordingControls';
import { shortcutLabel } from '../../../shared/shortcut-label';

export function RecordingTimer({ recording }: { recording: LauncherRecordingControls }) {
  return <span className="launcher-session launcher-recording-timer" aria-label="录制时长"><i />{recording.label}</span>;
}

export function RecordingStop({ recording }: { recording: LauncherRecordingControls }) {
  const preparing = recording.state?.status === 'starting';
  return <button className="launcher-start" aria-label="停止并编辑" data-toolbar-focus="stop" aria-busy={preparing || recording.stopping}
    title={shortcutLabel('停止并编辑 · Ctrl+Shift+R')} disabled={preparing || !recording.active || recording.stopping}
    onClick={() => void recording.control({ type: 'stop' })}>
    {preparing || recording.stopping ? <LoaderCircle size={15} className="launcher-spinning" /> : <Square size={11} fill="currentColor" strokeWidth={0} />}
    <span>{recording.stopping ? '保存中' : preparing ? '准备中' : '停止并编辑'}</span>
  </button>;
}
