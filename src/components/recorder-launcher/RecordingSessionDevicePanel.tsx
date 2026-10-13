import { useState } from 'react';
import { AlertCircle, Mic, X } from 'lucide-react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import type { LauncherRecordingControls } from '../../hooks/useLauncherRecordingControls';
import { LauncherCameraPanel } from './LauncherCameraPanel';
import { CameraEffectsControls } from '../camera-effects/CameraEffectsControls';
import { ORIGINAL_CAMERA_EFFECTS } from '../../../shared/camera-effects';
import { useLauncherPanelDrag } from '../../hooks/useLauncherPanelDrag';
import { CameraShapePicker } from '../camera-shapes/CameraShapePicker';

export function RecordingSessionDevicePanel({ model, recording }: {
  model: RecorderLauncherModel; recording: LauncherRecordingControls;
}) {
  const drag = useLauncherPanelDrag(), state = recording.state;
  const [pending, setPending] = useState(false), [error, setError] = useState<string>();
  const microphone = model.panel === 'microphone';
  const audio = async (enabled: boolean, deviceId = state?.microphoneDeviceId ?? model.microphoneDeviceId) => {
    if (pending) return;
    setPending(true); setError(undefined);
    try { await recording.control({ type: 'microphone-source', value: { enabled, deviceId } }); }
    finally { setPending(false); }
  };
  const cameraEnabled = async (enabled: boolean) => {
    if (pending) return;
    setPending(true); setError(undefined);
    try {
      if (!state?.cameraAvailable && enabled) await model.camera.startWhileRecording();
      else await recording.control({ type: 'camera-visible', value: enabled });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '摄像头操作失败'); }
    finally { setPending(false); }
  };
  const busy = pending || !recording.active;
  return <section className="launcher-panel launcher-panel-session-device" {...drag} data-toolbar-surface aria-label={microphone ? '录制中麦克风设置' : '录制中摄像头设置'}>
    <header className="launcher-panel-header"><h1>{microphone ? '麦克风' : '摄像头'}</h1>
      <button className="launcher-icon" aria-label="收起设备设置" onClick={() => model.setPanel(null)}><X size={17} /></button></header>
    <div className="launcher-panel-content">
      {microphone ? <div className="launcher-device-settings">
        <label className="launcher-switch"><Mic size={16} /><span>录制麦克风</span><input type="checkbox" checked={!!state?.microphoneEnabled}
          disabled={busy || model.status?.platform !== 'darwin'} onChange={event => void audio(event.target.checked)} /></label>
        <label className="launcher-field"><span>设备</span><select aria-label="录制中麦克风设备" value={state?.microphoneDeviceId ?? model.microphoneDeviceId}
          disabled={busy || model.status?.platform !== 'darwin' || model.loadingMicrophones} onChange={event => void audio(true, event.target.value)}>
          <option value="">系统默认麦克风</option>{model.microphones.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
        </select></label>
        <button className="launcher-menu-row" disabled={busy || !state?.microphoneEnabled} onClick={() => void recording.control({ type: 'microphone-muted', value: !state?.microphoneMuted })}>
          <Mic size={16} /><span>{state?.microphoneMuted ? '取消静音' : '静音麦克风'}</span></button>
      </div> : <>
        <LauncherCameraPanel recording model={{ ...model, busy: busy || model.camera.loading,
          camera: { ...model.camera, enabled: !!state?.cameraAvailable && !!state.cameraVisible,
            onEnabledChange: value => void cameraEnabled(value) } }} />
        {state?.cameraAvailable && <CameraEffectsControls value={state.cameraEffects ?? ORIGINAL_CAMERA_EFFECTS} disabled={busy}
          onChange={(_value, value) => void recording.control({ type: 'camera-effects', value })} />}
        {state?.cameraAvailable && <button className="launcher-menu-row" disabled={busy} aria-pressed={state.cameraMirror}
          onClick={() => void recording.control({ type: 'camera-mirror', value: !state.cameraMirror })}>镜像人物画面</button>}
        {state?.cameraAvailable && <div className="launcher-device-settings">
          <CameraShapePicker value={state.cameraShape} disabled={busy} onChange={value => void recording.control({ type: 'camera-shape', value })} />
          <label className="launcher-field"><span>人物大小</span><input aria-label="录制中人物大小" type="range" min={12} max={42}
            value={Math.round(state.cameraSize * 100)} disabled={busy} onChange={event => void recording.control({ type: 'camera-size', value: Number(event.target.value) / 100 })} /></label>
          <label className="launcher-field"><span>人物变焦</span><input aria-label="录制中人物变焦" type="range" min={1} max={3} step={.05}
            value={state.cameraZoom ?? 1} disabled={busy} onChange={event => void recording.control({ type: 'camera-zoom', value: Number(event.target.value) })} /></label>
        </div>}
      </>}
      {(error || recording.error) && <div className="launcher-inline-error" role="alert"><AlertCircle size={15} />{error ?? recording.error}</div>}
    </div>
  </section>;
}
