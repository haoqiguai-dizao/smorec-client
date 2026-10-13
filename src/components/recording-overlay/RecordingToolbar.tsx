import { AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { useRecordingOverlay } from '../../hooks/useRecordingOverlay';
import { useCameraSettings } from '../../hooks/useCameraSettings';
import { useToolbarAutoCollapse } from '../../hooks/useToolbarAutoCollapse';
import { recordingSessionDevices } from '../../services/recording-session-devices';
import { SessionToolbar } from '../session-controls/SessionToolbar';

export function RecordingToolbar() {
  const { state, error, elapsed, control, active, stopping } = useRecordingOverlay();
  const settings = useCameraSettings(state);
  const [boardBusy, setBoardBusy] = useState(false);
  const warning = error ?? settings.error ?? state?.error ?? state?.warnings?.join('；');
  const collapse = useToolbarAutoCollapse({ enabled: state?.status === 'recording',
    keepExpanded: settings.open || settings.busy || boardBusy || stopping || !!warning });
  const seconds = Math.max(0, Math.floor(elapsed));
  const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  return <main className="recording-toolbar-window" ref={collapse.containerRef} {...collapse.interactionProps}>
    <SessionToolbar mode="record" label={stopping ? '保存中' : state?.status === 'starting' ? '准备中' : '录屏中'}
      time={time} devices={recordingSessionDevices(state, active, control)} compact={collapse.collapsed} pending={stopping}
      toolsOpen={settings.open} collapse={collapse.collapse} expand={collapse.expand}
      tools={() => void settings.setOpen(!settings.open)} stop={() => void control({ type: 'stop' })} onBoardBusy={setBoardBusy} />
    {warning && <span className="overlay-warning" role="alert" aria-label={warning} title={warning}><AlertCircle size={16} /></span>}
  </main>;
}
