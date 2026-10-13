import { Eye, EyeOff, Info, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { StreamProfilesModel } from '../../hooks/useStreamProfiles';
import type { StreamConnection } from '../../../shared/streaming';
import './stream-settings.css';

export function StreamSettings({ model: m, active, connection }: { model: StreamProfilesModel; active: boolean; connection?: StreamConnection }) {
  const [visible, setVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const disabled = active || m.busy;
  const label = connection?.status === 'streaming' ? '推流中' : connection?.status === 'reconnecting' ? '正在重连'
    : connection?.status === 'failed' ? '连接失败' : '正在连接';
  return <section className="launcher-stream-settings" aria-label="直接推流设置">
    {active && connection && <div className="launcher-stream-status" role="status"><strong>{label}</strong>
      <span>{connection.bitrate > 0 ? `${Math.round(connection.bitrate)} kbps · ` : ''}{connection.frames} 帧 · 丢帧 {connection.dropped}</span>
      <i title={connection.error ?? '推流中表示编码数据已传出；公开开播、标题、封面和受众在平台后台设置。'}><Info size={14} /></i></div>}
    <div className="launcher-stream-profile"><select aria-label="推流配置" disabled={disabled} value={m.selected}
      onChange={event => { setVisible(false); setDeleting(false); void m.select(event.target.value); }}>
      <option value="">新建配置</option>{m.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button className="launcher-icon" aria-label="新建推流配置" disabled={disabled} onClick={() => { setVisible(false); setDeleting(false); void m.select(''); }}><Plus size={16} /></button>
      <button className="launcher-icon" aria-label="删除推流配置" disabled={disabled || !m.selected} onClick={() => setDeleting(true)}><Trash2 size={15} /></button>
      <button className="launcher-live-info launcher-icon" title="支持提供 RTMP／RTMPS 地址的平台。地址和流密钥以明文保存在本机；平台直播资格、推流规格和公开开播由平台管理。" aria-label="推流接入说明"><Info size={15} /></button>
    </div>
    {deleting && <div className="launcher-stream-delete">删除当前配置？<button disabled={disabled} onClick={() => { setDeleting(false); void m.remove(); }}>删除</button><button onClick={() => setDeleting(false)}>取消</button></div>}
    <label>配置名称<input aria-label="推流配置名称" disabled={disabled} value={m.draft.name} maxLength={80} placeholder="例如：X、YouTube、哔哩哔哩"
      onChange={event => m.change({ name: event.target.value })} /></label>
    <label>推流地址<input aria-label="推流地址" disabled={disabled} value={m.draft.server} maxLength={4096} spellCheck={false} autoComplete="off"
      placeholder="rtmps://…" onChange={event => m.change({ server: event.target.value })} /></label>
    <label>流密钥<span className="launcher-stream-key"><input aria-label="流密钥" type={visible ? 'text' : 'password'} disabled={disabled}
      value={m.draft.key} maxLength={2048} spellCheck={false} autoComplete="new-password" placeholder="完整推流 URL 可留空"
      onChange={event => m.change({ key: event.target.value })} /><button className="launcher-icon" aria-label={visible ? '隐藏流密钥' : '显示流密钥'}
      aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
    <div className="launcher-stream-encoding">
      <label>画质<select aria-label="推流画质" disabled={disabled} value={m.draft.resolution} onChange={event => m.change({ resolution: event.target.value as '720p' | '1080p' })}><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
      <label>帧率<select aria-label="推流帧率" disabled={disabled} value={m.draft.fps} onChange={event => m.change({ fps: Number(event.target.value) as 30 | 60 })}><option value={30}>30 FPS</option><option value={60}>60 FPS</option></select></label>
      <label>码率 kbps<input aria-label="推流码率" type="number" min={500} max={20000} step={500} disabled={disabled} value={m.draft.bitrate} onChange={event => m.change({ bitrate: Number(event.target.value) })} /></label>
      <label>关键帧 秒<input aria-label="推流关键帧间隔" type="number" min={1} max={10} disabled={disabled} value={m.draft.keyframeSeconds} onChange={event => m.change({ keyframeSeconds: Number(event.target.value) })} /></label>
    </div>
    <div className="launcher-stream-save"><span>{m.dirty ? '有未保存的修改' : m.selected ? '已保存' : ''}</span>
      <button className="launcher-start" disabled={disabled || !m.dirty && !!m.selected} onClick={() => void m.save()}><Save size={14} />{m.busy ? '保存中' : '保存配置'}</button></div>
    {m.error && <div className="launcher-inline-error" role="alert">{m.error}</div>}
  </section>;
}
