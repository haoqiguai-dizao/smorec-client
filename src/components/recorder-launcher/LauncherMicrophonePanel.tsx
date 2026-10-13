import { AlertCircle, CircleHelp, Info, LoaderCircle, Mic, Pause, Play, RotateCcw, Square } from 'lucide-react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { useMicrophoneTrial } from '../../hooks/useMicrophoneTrial';
import { MicrophoneEffectsControls } from '../microphone-effects/MicrophoneEffectsControls';
import './microphone-trial.css';

export function LauncherMicrophonePanel({ model: m }: { model: RecorderLauncherModel }) {
  const trial = useMicrophoneTrial(m.microphoneDeviceId, m.microphone && !m.busy, m.microphoneEffects);
  const testing = ['starting', 'recording', 'finishing'].includes(trial.phase);
  const defaultDevice = m.microphones.find(device => device.isDefault);
  const selectedDevice = m.microphoneDeviceId ? m.microphones.find(device => device.id === m.microphoneDeviceId) : defaultDevice;
  const label = (device: typeof selectedDevice) => device ? `${device.name}${device.transport === 'bluetooth' ? ' · 蓝牙' : device.transport === 'usb' ? ' · USB' : ''}` : '';
  return <div className="launcher-device-settings">
    <label className="launcher-switch"><Mic size={16} /><span>录制麦克风</span><input type="checkbox" checked={m.microphone} disabled={m.busy} onChange={event => m.setMicrophone(event.target.checked)} /></label>
    <label className="launcher-field"><span>设备</span><select aria-label="麦克风设备" value={m.microphoneDeviceId} disabled={m.busy || testing || !m.microphone || m.loadingMicrophones} onChange={event => m.setMicrophoneDeviceId(event.target.value)}>
      <option value="">系统默认麦克风{defaultDevice ? ` · ${label(defaultDevice)}` : ''}</option>
      {m.microphoneDeviceId && !m.microphones.some(device => device.id === m.microphoneDeviceId) && <option value={m.microphoneDeviceId}>已断开的麦克风</option>}
      {m.microphones.map(device => <option key={device.id} value={device.id}>{label(device)}</option>)}
    </select></label>
    {selectedDevice?.transport === 'bluetooth' && <details className="mic-connection-help"><summary><Info size={14} />蓝牙输入兼容</summary>
      <p>小录自动使用独立输入通道，保留当前音箱与设备采样率。设备断开或无法继续采集时会提示，不会擅自换用其他麦克风。</p>
    </details>}
    {m.microphone && m.microphoneError && <div className="launcher-inline-error" role="alert"><AlertCircle size={14} />{m.microphoneError}</div>}
    <MicrophoneEffectsControls value={m.microphoneEffects} onChange={m.setMicrophoneEffects} disabled={m.busy || !m.microphone} />
    <div className="microphone-trial" aria-label="麦克风试听">
      {trial.phase === 'recording' ? <button className="mic-trial-action primary" onClick={() => void trial.finish()}><Square size={12} />结束试录</button>
        : <button className="mic-trial-action" disabled={m.busy || !m.microphone || testing || !!m.microphoneError} onClick={() => void trial.start()}>
          {testing ? <LoaderCircle size={14} className="launcher-spinning" /> : trial.sample ? <RotateCcw size={14} /> : <Mic size={14} />}{testing ? trial.phase === 'starting' ? '连接麦克风' : '保存试录' : trial.sample ? '重新试录' : '试录 10 秒'}</button>}
      {testing && <span className="mic-trial-time">{trial.elapsed.toFixed(1)} / 10 s</span>}
      {!trial.sample && <button className="mic-help" aria-label="麦克风试听说明" title="用平常的音量说几句话，再听原声与效果对比。试录最长 10 秒，可提前结束；正式录制前会停止试听并释放设备。"><CircleHelp size={14} /></button>}
      {trial.sample && <><div className="mic-trial-comparison" role="group" aria-label="试听对比">{(['original', 'effect'] as const).map(mode =>
        <button key={mode} type="button" aria-pressed={trial.comparison === mode} onClick={() => trial.compare(mode)}>{mode === 'original' ? '原声' : '效果'}</button>)}</div>
        <button className="mic-trial-action" disabled={!trial.canPlay} onClick={() => void trial.play()}>{trial.playing ? <Pause size={14} /> : <Play size={14} />}{trial.playing ? '暂停试听' : '播放试听'}</button></>}
      {trial.processing && <span className="mic-trial-status"><LoaderCircle size={13} className="launcher-spinning" />处理声音</span>}
      {trial.error && <span className="mic-trial-status error" role="alert"><AlertCircle size={14} />{trial.error}</span>}
    </div>
  </div>;
}
