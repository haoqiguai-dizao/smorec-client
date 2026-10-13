import { AlertCircle, Info, LoaderCircle, Settings2, Video } from 'lucide-react';
import { useState } from 'react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { CAMERA_RESOLUTIONS, cameraFormatLabel, cameraFormatNotice, cameraResolutionAvailable, type CameraResolution } from '../../services/camera-format';
import './camera-format.css';
import { LauncherCameraRecovery } from './LauncherCameraRecovery';

export function LauncherCameraPanel({ model: m, recording = false }: { model: RecorderLauncherModel; recording?: boolean }) {
  const [opening, setOpening] = useState(false), [error, setError] = useState<string>();
  const formatNotice = cameraFormatNotice(m.camera.format, m.camera.actualFormat);
  const cameraError = m.camera.error ?? (m.cameraErrorVisible ? m.error : undefined);
  const sourceKept = recording && (m.camera.sourceStream ?? m.camera.stream)?.getVideoTracks().some(track => track.readyState === 'live');
  const openSettings = async () => {
    if (opening) return;
    setOpening(true); setError(undefined);
    try {
      if (!window.recorder) throw new Error('请从小录桌面版调整画面');
      await window.recorder.openCameraSettings(); m.setPanel(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开画面设置'); }
    finally { setOpening(false); }
  };
  return <div className="launcher-device-settings">
    <label className="launcher-switch"><Video size={16} /><span>录制摄像头</span><input type="checkbox" checked={m.camera.enabled} disabled={m.busy} onChange={event => m.camera.onEnabledChange(event.target.checked)} /></label>
    {cameraError && (sourceKept ? <div className="launcher-inline-error" role="alert"><AlertCircle size={14} />{cameraError}</div>
      : <LauncherCameraRecovery model={m} message={cameraError} inline />)}
    <label className="launcher-field"><span>设备</span><select aria-label="摄像头设备" value={m.camera.selectedDeviceId} disabled={m.busy} onChange={event => m.camera.onDeviceChange(event.target.value)}>
      {!m.camera.devices.length && <option value="">{m.camera.loading ? '正在读取设备…' : '系统默认摄像头'}</option>}
      {m.camera.devices.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || '系统默认摄像头（名称未获取）'}</option>)}
    </select></label>
    <div className="camera-format-fields">
      <label className="launcher-field"><span>{recording ? '采集分辨率' : '录制分辨率'}</span><select aria-label={recording ? '摄像头采集分辨率' : '摄像头录制分辨率'} value={m.camera.format.resolution}
        disabled={m.busy || m.camera.loading} onChange={event => m.camera.onFormatChange({ ...m.camera.format, resolution: event.target.value as CameraResolution })}>
        {CAMERA_RESOLUTIONS.map(item => <option key={item.value} value={item.value}
          disabled={!cameraResolutionAvailable(item.value, (m.camera.sourceStream ?? m.camera.stream)?.getVideoTracks()[0])}>{item.label}</option>)}
      </select></label>
      <label className="launcher-field"><span>{recording ? '采集帧率' : '帧率'}</span><select aria-label={recording ? '摄像头采集帧率' : '摄像头录制帧率'} value={m.camera.format.fps}
        disabled={m.busy || m.camera.loading || m.camera.format.resolution === 'auto'} onChange={event => m.camera.onFormatChange({ ...m.camera.format, fps: Number(event.target.value) as 30 | 60 })}>
        <option value={30}>30 FPS</option><option value={60}>60 FPS</option>
      </select></label>
    </div>
    <div className={`camera-format-actual ${formatNotice ? 'limited' : ''}`} role="status">
      <span>{m.camera.loading ? '正在确认设备格式…' : m.camera.actualFormat ? `实际 ${cameraFormatLabel(m.camera.actualFormat)}` : '连接后显示实际格式'}</span>
      <span tabIndex={0} aria-label={formatNotice ?? (recording ? '录中调整采集格式，视频文件保持开录时的画幅和帧率。' : '采用摄像头连接电脑后实际提供的格式；与设备机内录像规格可能不同。')}
        title={formatNotice ?? (recording ? '录中调整采集格式，视频文件保持开录时的画幅和帧率。' : '采用摄像头连接电脑后实际提供的格式；与设备机内录像规格可能不同。')}><Info size={13} aria-hidden="true" /></span>
    </div>
    {!recording && <button type="button" className="launcher-menu-row" aria-label="打开摄像头画面设置"
      disabled={m.busy || opening || !m.camera.enabled || m.camera.loading || !m.camera.stream || !!m.camera.error} onClick={() => void openSettings()}>
      {opening ? <LoaderCircle size={16} className="launcher-spinning" /> : <Settings2 size={16} />}<span>画面设置</span>
    </button>}
    {error && <div className="launcher-inline-error" role="alert"><AlertCircle size={14} />{error}</div>}
  </div>;
}
