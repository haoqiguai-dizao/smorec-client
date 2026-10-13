import { AlertCircle, AppWindow, Check, ChevronDown, Crop, LoaderCircle, Mic, Monitor, RefreshCw, Settings2, Video, Volume2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CaptureSource, RecordingOptions, Rect } from '../../../shared/types';
import { recordingOutputSize } from '../../../shared/recording';
import { CameraPreview, type CameraControls } from './CameraPreview';
import { RegionEditor } from './RegionEditor';
import { SourcePicker } from './SourcePicker';
import { MicrophoneSelector } from './MicrophoneSelector';
import { useMicrophoneDevices } from '../../hooks/useMicrophoneDevices';

export interface RecordingSetupProps { sources: CaptureSource[]; loading: boolean; onRefresh: () => void; onClose: () => void; onStart: (options: RecordingOptions) => void; busy: boolean; error?: string; camera?: CameraControls }
type Mode = 'screen' | 'window' | 'region';

export function RecordingSetup({ sources, loading, onRefresh, onClose, onStart, busy, error, camera }: RecordingSetupProps) {
  const [mode, setMode] = useState<Mode>('screen');
  const [sourceId, setSourceId] = useState('');
  const [systemAudio, setSystemAudio] = useState(true);
  const [microphone, setMicrophone] = useState(false);
  const [microphoneDeviceId, setMicrophoneDeviceId] = useState('');
  const microphoneDevices = useMicrophoneDevices(microphone, microphoneDeviceId);
  const [fps, setFps] = useState<30 | 60>(30);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [crop, setCrop] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  const visibleSources = sources.filter(source => source.kind === (mode === 'window' ? 'window' : 'screen'));
  const selected = visibleSources.find(source => source.id === sourceId) ?? visibleSources[0];
  const sourceWidth = selected?.width ?? 0;
  const sourceHeight = selected?.height ?? 0;
  let output: { width: number; height: number } | undefined, formatError: string | undefined;
  if (selected && (mode !== 'region' || (crop.width >= 32 && crop.height >= 32))) {
    try { output = recordingOutputSize(mode === 'region' ? crop.width : sourceWidth, mode === 'region' ? crop.height : sourceHeight); }
    catch (cause) { formatError = cause instanceof Error ? cause.message : '录制尺寸不受支持'; }
  }
  useEffect(() => { setCrop({ x: 0, y: 0, width: sourceWidth, height: sourceHeight }); }, [selected?.id, sourceWidth, sourceHeight, mode]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [busy, onClose]);
  const cropValid = Object.values(crop).every(Number.isInteger) && crop.x >= 0 && crop.y >= 0 && crop.width >= 32 && crop.height >= 32 && crop.x + crop.width <= sourceWidth && crop.y + crop.height <= sourceHeight;
  const cameraReady = !camera?.enabled || (!!camera.stream?.getVideoTracks().some(track => track.readyState === 'live') && !camera.loading && !camera.error);
  const valid = !!selected && !!output && !formatError && (mode !== 'region' || cropValid) && cameraReady && microphoneDevices.ready;
  const start = () => { if (selected && valid) onStart({ sourceId: selected.id, systemAudio, microphone, fps, ...(microphone && microphoneDeviceId ? { microphoneDeviceId } : {}), ...(mode === 'region' ? { crop } : {}) }); };
  return <div className="modal-backdrop recorder-backdrop"><section className="modal recorder-panel" role="dialog" aria-modal="true" aria-labelledby="recording-title">
    <header className="recorder-header"><span className="recorder-app-icon"><Monitor size={17} /></span><h2 id="recording-title">新建录制</h2><button className="icon-button" aria-label="关闭录制设置" onClick={onClose} disabled={busy}><X size={17} /></button></header>
    <div className="recorder-source-toolbar"><div className="recorder-mode-tabs" role="tablist" aria-label="录制范围">{([{ id: 'screen', label: '屏幕', icon: Monitor }, { id: 'window', label: '窗口', icon: AppWindow }, { id: 'region', label: '区域', icon: Crop }] as const).map(({ id, label, icon: Icon }) => <button role="tab" aria-selected={mode === id} key={id} className={mode === id ? 'active' : ''} disabled={busy} onClick={() => { setMode(id); setSourceId(''); }}><Icon size={17} />{label}</button>)}</div><button className="icon-button" title="刷新录制来源" aria-label="刷新录制来源" onClick={onRefresh} disabled={loading || busy}><RefreshCw size={14} className={loading ? 'spinning' : ''} /></button></div>
    <div className="recorder-source-area">{loading && !sources.length ? <div className="recorder-source-empty"><LoaderCircle className="spinning" size={23} /><span>正在查找可录制的内容</span></div> : visibleSources.length ? <SourcePicker sources={visibleSources} selectedId={selected?.id} busy={busy} onSelect={setSourceId} /> : <div className="recorder-source-empty"><Monitor size={24} /><span>没有可用{mode === 'window' ? '窗口' : '屏幕'}</span><button className="text-button" onClick={onRefresh}>重新查找</button></div>}</div>
    {mode === 'region' && selected && <RegionEditor source={selected} crop={crop} valid={cropValid} disabled={busy} onChange={setCrop} />}
    <div className="recorder-devices"><button className={`recorder-device ${camera?.enabled ? 'enabled' : ''}`} aria-label="摄像头" aria-pressed={!!camera?.enabled} title="摄像头独立录制，录制后可调整位置和大小" disabled={busy || !camera} onClick={() => camera?.onEnabledChange(!camera.enabled)}><Video size={17} /><span>摄像头</span><span className="device-state">{camera?.enabled ? '开' : '关'}</span></button><button className={`recorder-device ${microphone ? 'enabled' : ''}`} aria-pressed={microphone} aria-label="麦克风" title="选择要录制的麦克风" disabled={busy} onClick={() => setMicrophone(!microphone)}><Mic size={17} /><span>麦克风</span><span className="device-state">{microphone ? '开' : '关'}</span></button><button className={`recorder-device ${systemAudio ? 'enabled' : ''}`} aria-pressed={systemAudio} title="录制系统播放的声音" disabled={busy} onClick={() => setSystemAudio(!systemAudio)}><Volume2 size={17} /><span>系统声音</span><span className="device-state">{systemAudio ? '开' : '关'}</span></button></div>
    {camera?.enabled && <section className="recorder-camera"><CameraPreview stream={camera.stream} loading={camera.loading} error={camera.error} /><div className="recorder-camera-settings"><div className="camera-device-heading"><Video size={14} /><strong>摄像头</strong><button className="icon-button" aria-label="刷新摄像头" onClick={camera.onRefresh} disabled={busy || camera.loading}><RefreshCw size={12} className={camera.loading ? 'spinning' : ''} /></button></div><select aria-label="选择摄像头" value={camera.selectedDeviceId} disabled={busy || camera.loading} onChange={event => camera.onDeviceChange(event.target.value)}>{!camera.devices.length && <option value="">{camera.loading ? '正在查找设备…' : '未发现摄像头'}</option>}{camera.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `摄像头 ${index + 1}`}</option>)}</select><span className={`camera-device-status ${camera.error ? 'error' : ''}`}>{camera.error ? camera.error : camera.loading ? '正在准备预览' : camera.stream ? <><Check size={12} />设备已就绪</> : '允许访问摄像头后继续'}</span></div></section>}
    {microphone && <MicrophoneSelector devices={microphoneDevices.devices} selectedId={microphoneDeviceId} loading={microphoneDevices.loading} disabled={busy} error={microphoneDevices.error} onChange={setMicrophoneDeviceId} onRefresh={() => void microphoneDevices.refresh()} />}
    <button className="recorder-advanced-toggle" onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen}><Settings2 size={13} /><span>录制设置</span><span>{fps} FPS</span><ChevronDown size={12} style={{ transform: settingsOpen ? 'rotate(180deg)' : undefined }} /></button>
    {settingsOpen && <div className="recorder-advanced"><span>帧率</span><div className="segmented-choice">{([30, 60] as const).map(value => <button key={value} disabled={busy} className={fps === value ? 'selected' : ''} onClick={() => setFps(value)}>{value} FPS</button>)}</div></div>}
    {(error || formatError || (mode === 'region' && !cropValid)) && <div className="inline-error" role="alert"><AlertCircle size={15} /><span>{error || formatError || '录制区域须位于屏幕内，宽高至少 32 像素。'}</span></div>}
    <footer className="recorder-footer"><span title="按来源物理像素录制；H.264 尺寸向下对齐到偶数。">{output ? `录制 ${output.width} × ${output.height} · ${fps} FPS` : '请选择录制内容'}</span><button className="button recorder-start" onClick={start} disabled={!valid || loading || busy}>{busy ? <LoaderCircle className="spinning" size={15} /> : <span className="record-dot" />}{busy ? '正在准备…' : '开始录制'}</button></footer>
  </section></div>;
}
