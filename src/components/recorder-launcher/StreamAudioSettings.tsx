import { Info, RefreshCw } from 'lucide-react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';

export function StreamAudioSettings({ model: m, active }: { model: RecorderLauncherModel; active: boolean }) {
  return <div className="launcher-stream-audio" aria-label="推流声音">
    <div><label><input type="checkbox" checked={m.microphone} disabled={active} onChange={event => m.setMicrophone(event.target.checked)} />麦克风</label>
      <label><input type="checkbox" checked={m.systemAudio} disabled={active} onChange={event => m.setSystemAudio(event.target.checked)} />系统声音</label>
      <i title="声音与画面在小录中合成。平台预览请静音，避免预览声音再次进入系统声音。声音来源在开始推流前设置。"><Info size={14} /></i></div>
    {m.microphone && <div><select aria-label="直播麦克风设备" disabled={active || m.loadingMicrophones} value={m.microphoneDeviceId ?? ''}
      onChange={event => m.setMicrophoneDeviceId(event.target.value)}><option value="">系统默认麦克风</option>
      {m.microphones.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select>
      <button className="launcher-icon" aria-label="刷新直播麦克风" disabled={active || m.loadingMicrophones} onClick={() => void m.refreshMicrophones()}><RefreshCw size={14} /></button></div>}
    {m.microphone && m.microphoneError && <div className="launcher-inline-error" role="alert">{m.microphoneError}</div>}
  </div>;
}
