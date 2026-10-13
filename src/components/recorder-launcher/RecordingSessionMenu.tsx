import { AlertCircle, Settings2, X } from 'lucide-react';
import type { LauncherRecordingControls } from '../../hooks/useLauncherRecordingControls';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { useLauncherPanelDrag } from '../../hooks/useLauncherPanelDrag';
import { WhiteboardButton } from '../recording-overlay/WhiteboardButton';
import { AudioCacheSettings } from './AudioCacheSettings';
import { DistributionSettings } from './DistributionSettings';
import { MacPermissionSettings } from './MacPermissionSettings';
import { SessionQuitAction } from '../session-controls/SessionQuitAction';

export function RecordingSessionMenu({ model, recording, onBusy, close }: {
  model: RecorderLauncherModel; recording: LauncherRecordingControls; onBusy(busy: boolean): void; close(): void;
}) {
  const drag = useLauncherPanelDrag();
  return <section className="launcher-panel launcher-panel-session" id="recording-session-tools" aria-label="录制工具" {...drag} data-toolbar-surface>
    <header className="launcher-panel-header"><h1>录制工具</h1>
      <button className="launcher-icon" aria-label="收起设置" onClick={close}><X size={17} /></button>
    </header>
    <div className="launcher-panel-content">
      <div className="recording-session-tools">
        <span className="recording-session-whiteboard"><WhiteboardButton launcher onBusy={onBusy} /></span>
        <button className="launcher-mode recording-session-camera-settings" aria-label="画面设置" aria-pressed={recording.settings.open}
          disabled={!recording.active || !recording.state?.cameraAvailable || !recording.state.cameraVisible || recording.settings.busy}
          onClick={() => void recording.settings.setOpen(!recording.settings.open)}><Settings2 size={18} /><span>画面设置</span></button>
      </div>
      <details className="recording-session-other"><summary>应用设置</summary>
        <DistributionSettings /><AudioCacheSettings />
        {model.status?.platform === 'darwin' && <MacPermissionSettings disabled={model.busy} />}
      </details>
      {model.error && <div className="launcher-inline-error" role="alert"><AlertCircle size={15} />{model.error}</div>}
      <SessionQuitAction disabled={recording.stopping || model.state.status === 'starting'} />
    </div>
  </section>;
}
