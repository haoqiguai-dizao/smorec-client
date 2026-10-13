import { Eye, EyeOff, Info, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { StreamProfilesModel } from '../../hooks/useStreamProfiles';
import { StreamEncodingSettings } from './StreamEncodingSettings';
import './stream-settings.css';

export function LiveConnectionSettings({ model: m, next }: { model: StreamProfilesModel; next(): void }) {
  const [visible, setVisible] = useState(false), [deleting, setDeleting] = useState(false);
  const advance = async () => { if (m.ready || await m.save({ name: m.draft.name.trim() || '我的直播' })) next(); };
  const help = <button type="button" className="launcher-icon" aria-label="在哪里获取直播地址" title="在平台的直播后台创建直播，复制推流地址和直播密钥。支持提供 RTMP / RTMPS 接入的平台；标题、封面与受众在平台后台设置。"><Info size={16} /></button>;
  return <form className="launcher-stream-settings live-connection" onSubmit={event => { event.preventDefault(); void advance(); }}>
    {m.profiles.length > 0 && <div className="launcher-stream-profile"><select aria-label="推流配置" disabled={m.busy} value={m.selected}
      onChange={event => { setVisible(false); setDeleting(false); void m.select(event.target.value); }}>
      <option value="">连接新平台</option>{m.profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button type="button" className="launcher-icon" aria-label="新建推流配置" disabled={m.busy} onClick={() => { setVisible(false); void m.select(''); }}><Plus size={16} /></button>
      {m.selected && <button type="button" className="launcher-icon" aria-label="删除推流配置" disabled={m.busy} onClick={() => setDeleting(true)}><Trash2 size={15} /></button>}
      {help}
    </div>}
    {deleting && <div className="launcher-stream-delete">删除这个连接？<button type="button" disabled={m.busy} onClick={() => { setDeleting(false); void m.remove(); }}>删除</button><button type="button" onClick={() => setDeleting(false)}>取消</button></div>}
    {!m.selected && <label><span className="live-platform-heading">直播平台{!m.profiles.length && help}</span><select aria-label="直播平台" disabled={m.busy} value={['X', 'YouTube', 'Twitch', '哔哩哔哩'].includes(m.draft.name) ? m.draft.name : ''}
      onChange={event => m.change({ name: event.target.value })}><option value="">其他平台 / 自定义</option>{['X', 'YouTube', 'Twitch', '哔哩哔哩'].map(name => <option key={name}>{name}</option>)}</select></label>}
    <label>直播地址<input aria-label="推流地址" required type="url" disabled={m.busy} value={m.draft.server} maxLength={4096} spellCheck={false} autoComplete="off"
      placeholder="粘贴平台提供的推流地址" onChange={event => m.change({ server: event.target.value })} /></label>
    <label>直播密钥<span className="launcher-stream-key"><input aria-label="流密钥" type={visible ? 'text' : 'password'} disabled={m.busy}
      value={m.draft.key} maxLength={2048} spellCheck={false} autoComplete="new-password" placeholder="粘贴直播密钥；完整地址可留空"
      onChange={event => m.change({ key: event.target.value })} /><button type="button" className="launcher-icon" aria-label={visible ? '隐藏流密钥' : '显示流密钥'}
      onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}</button></span></label>
    <details className="live-advanced"><summary>高级设置 <Info size={13} aria-label="默认参数适合日常直播，可按平台要求调整" /></summary>
      <label>连接名称<input aria-label="推流配置名称" disabled={m.busy} value={m.draft.name} maxLength={80} placeholder="我的直播" onChange={event => m.change({ name: event.target.value })} /></label>
      <StreamEncodingSettings model={m} disabled={m.busy} />
    </details>
    {m.error && <div className="launcher-inline-error" role="alert">{m.error}</div>}
    <footer className="live-workflow-footer"><span className="live-quiet">{m.selected && !m.dirty ? '已记住这个连接' : '连接信息保存在本机'}</span>
      <button className="launcher-start" disabled={m.busy} type="submit">{m.busy ? '保存中' : '下一步'}</button></footer>
  </form>;
}
