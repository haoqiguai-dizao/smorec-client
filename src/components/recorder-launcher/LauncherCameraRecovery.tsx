import { ChevronRight, RefreshCw, Video } from 'lucide-react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import './camera-recovery.css';

/** Device recovery does not own permissions or the active recording/live output. */
export function LauncherCameraRecovery({ model: m, message, inline = false }: {
  model: RecorderLauncherModel; message: string; inline?: boolean;
}) {
  const suspended = message.includes('已被系统暂停');
  const builtIn = suspended && message.includes('内置');
  const selected = m.camera.devices.find(device => device.deviceId === m.camera.selectedDeviceId);
  return <div className="launcher-camera-recovery">
    <h2>摄像头暂不可用</h2>
    <div className="permission-guide-device"><Video size={25} /><strong>{builtIn ? '内置摄像头' : selected?.label || '所选摄像头'}</strong>
      <span><i />{suspended ? '已暂停' : '未就绪'}</span></div>
    <p role="status">{builtIn ? '打开电脑上盖后重试，或使用外接摄像头。' : message}</p>
    <div className="permission-guide-actions" role="group" aria-label="处理摄像头问题">
      <button type="button" disabled={m.busy} onClick={() => { m.camera.onEnabledChange(false); m.setPanel(null); m.clearError(); }}>不使用摄像头</button>
      <button type="button" className="primary" disabled={m.busy || m.camera.loading} onClick={() => {
        if (inline) m.setPanel('camera'); m.camera.onRefresh();
      }}><RefreshCw size={15} />{m.camera.loading ? '正在连接' : '重新连接'}</button>
    </div>
    {!inline && <button type="button" className="camera-recovery-change" disabled={m.busy} onClick={() => m.setPanel('camera')}>更换摄像头<ChevronRight size={14} /></button>}
  </div>;
}
