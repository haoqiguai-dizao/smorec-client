import { Camera, Check, Eye, EyeOff, Info, LoaderCircle, Monitor, Radio, Settings2, Volume2 } from 'lucide-react';
import type { LiveSessionModel } from '../../hooks/useLiveSession';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { StreamAudioSettings } from './StreamAudioSettings';
import { LauncherSourceTrigger } from './LauncherSourceTrigger';
import { SessionDevices } from '../session-controls/SessionDevices';
import type { SessionDevices as Devices } from '../session-controls/types';

export function LivePreviewSettings({ live, model: m, ready, start, back, changeConnection, cameraSettings, devices }: {
  live: LiveSessionModel; model: RecorderLauncherModel; ready: boolean; start(): void; back(): void; changeConnection(): void;
  cameraSettings?: { disabled: boolean; opening: boolean; open(): Promise<void> };
  devices?: Devices;
}) {
  const stopping = live.state.status === 'stopping';
  const preview = live.state.status === 'live' || stopping, transmitting = preview && live.state.phase === 'broadcast';
  const label = stopping ? '正在结束直播' : !preview ? '检查画面与声音' : !transmitting ? '本机预览 · 尚未开播' : live.output === 'camera' ? '正在输出到直播伴侣'
    : live.state.connection?.status === 'streaming' ? '直播信号已连接' : live.state.connection?.status === 'reconnecting' ? '正在重新连接' : '正在连接平台';
  return <section className={`live-preview-settings ${preview ? 'is-active' : ''}`}>
    <div className="live-destination-summary">{live.output === 'camera' ? <Camera size={18} /> : <Radio size={18} />}<strong>{live.output === 'camera' ? '直播伴侣 / 助手' : live.profiles.draft.name || '直接推流'}</strong><span>{live.output === 'camera' ? live.device?.installed ? '已安装' : '未安装' : '配置已保存'}</span>
      <button disabled={live.connecting || stopping || live.state.status === 'starting'} onClick={() => { if (preview) void live.stop().then(changeConnection); else changeConnection(); }}>{preview ? transmitting ? '停止并更改' : '结束预览并更改' : '更改'}</button></div>
    {live.output === 'camera' && <div className="live-virtual-device"><Camera size={16} /><span>小录 Virtual Camera</span></div>}
    <div className="live-preview-heading"><strong>{label}</strong><div className="live-preview-actions">
      {preview && <button className="launcher-icon" aria-label={live.previewEnabled ? '关闭画面预览' : '开启画面预览'} title={live.previewEnabled ? '关闭画面预览，输出继续' : '开启画面预览'} onClick={live.togglePreview}>{live.previewEnabled ? <Eye size={16} /> : <EyeOff size={16} />}</button>}
      <button className="launcher-icon" title={live.state.connection?.error ?? '本机预览不向平台发送画面。开始直播后，请在平台后台确认直播画面和公开状态。'} aria-label={live.state.connection?.error ? '推流连接详情' : '预览与开播说明'}><Info size={15} /></button></div></div>
    <div className={`live-preview-canvas ${live.portrait ? 'portrait' : ''}`} aria-label="直播画面预览">
      <div className="live-preview-mount" ref={live.previewRef} hidden={!live.previewEnabled} />
      {(!live.previewReady || !live.previewEnabled) && <div className="live-preview-placeholder">{live.state.status === 'starting' ? <LoaderCircle size={24} className="launcher-spinning" /> : <Monitor size={30} />}<span>{!live.previewEnabled ? '预览已关闭' : live.state.status === 'starting' ? '正在准备画面' : m.selected?.name ?? '请选择要直播的画面'}</span></div>}
    </div>
    {!preview ? <>
      <LauncherSourceTrigger model={m} />
      <div className="live-preview-devices"><label className="launcher-switch"><Camera size={15} /><span>摄像头</span><input type="checkbox" checked={m.camera.enabled} disabled={m.busy} onChange={event => { m.camera.onEnabledChange(event.target.checked); m.clearError(); }} /></label>
        <button className="launcher-icon" aria-label="选择摄像头" title="摄像头设置" disabled={m.busy} onClick={() => m.setPanel('camera')}><Settings2 size={17} /></button>
        <label><input type="checkbox" checked={live.portrait} disabled={m.busy} onChange={event => live.setPortrait(event.target.checked)} />竖屏直播</label></div>
      {m.camera.enabled && m.camera.error && <div className="live-recovery">摄像头暂不可用<button onClick={() => { m.camera.onEnabledChange(false); m.clearError(); }}>暂不使用摄像头</button></div>}
      {live.output === 'stream' && <StreamAudioSettings model={m} active={false} />}
      {live.output === 'stream' && m.microphone && m.microphoneError && <div className="live-recovery">{m.microphoneError}<button onClick={() => { m.setMicrophone(false); m.clearError(); }}>暂不使用麦克风</button></div>}
    </> : <><div className="live-audio-meter"><Volume2 size={15} /><span>{live.output === 'camera' ? '声音在伴侣中设置' : !m.microphone && !m.systemAudio ? '声音已关闭' : '声音'}</span>
      {live.output === 'stream' && <meter min={0} max={1} value={Math.sqrt(live.audioLevel)} aria-label="直播声音电平" />}
      {live.previewReady && <span className="live-preview-ready"><Check size={13} />画面就绪</span>}</div>
      {devices && <SessionDevices devices={devices} />}
      {cameraSettings && <button className="live-camera-adjust" disabled={cameraSettings.disabled} onClick={() => void cameraSettings.open()}><Settings2 size={15} />{cameraSettings.opening ? '正在打开' : '调整摄像头画面'}</button>}</>}
    <footer className="live-workflow-footer"><button className="live-back" disabled={live.connecting || live.state.status === 'starting'} onClick={() => { if (preview) m.setPanel(null); else back(); }}>{preview ? '收起设置' : '返回连接设置'}</button>
      {transmitting ? <button className="launcher-start" disabled={stopping} aria-busy={stopping} onClick={() => void live.stop()}>{stopping ? '结束中' : live.output === 'stream' ? '停止推流' : '停止输出'}</button> : preview
        ? <button className="launcher-start" aria-busy={live.connecting || stopping} disabled={!live.previewReady || live.connecting || stopping} onClick={() => void live.broadcast()}>{stopping ? '结束中' : live.connecting ? '正在连接' : live.output === 'stream' ? '开始推流' : '启动虚拟摄像头'}</button>
        : <button className="launcher-start" aria-busy={live.state.status === 'starting'} disabled={!ready || live.state.status === 'starting'} onClick={start}>{live.state.status === 'starting' ? '准备中' : '开始预览'}</button>}
    </footer>
  </section>;
}
