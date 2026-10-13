import { useEffect, useId, useState } from 'react';
import { ChevronDown, HardDrive, HelpCircle, RefreshCw } from 'lucide-react';
import { formatAudioCacheBytes as bytes, type AudioCacheSnapshot } from '../../../shared/audio-cache';
import './audio-cache-settings.css';

export function AudioCacheSettings() {
  const [state, setState] = useState<AudioCacheSnapshot>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [open, setOpen] = useState(false), [help, setHelp] = useState(false);
  const contentId = useId();
  const api = window.audioCache;
  useEffect(() => {
    if (!api) return;
    let live = true;
    setBusy(true);
    void api.state().then(value => { if (live) setState(value); })
      .catch(() => { if (live) setError('缓存容量读取失败，请刷新重试'); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [api]);
  if (!api) return null;
  const refresh = async (clear: boolean) => {
    setBusy(true); setError(''); setMessage('');
    try {
      if (clear) {
        const result = await api.clear(); setState(result.snapshot);
        setMessage(result.freedBytes ? `已释放 ${bytes(result.freedBytes)}` : '暂无可清理缓存，正在使用的文件会保留');
      } else setState(await api.state());
    } catch { setError(clear ? '缓存未能全部清理，请刷新后重试' : '缓存容量读取失败，请刷新重试'); }
    finally { setBusy(false); }
  };
  return <section className="audio-cache-settings" aria-label="存储管理">
    <button className="launcher-menu-row audio-cache-toggle" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)}>
      <HardDrive size={16} /><span>存储管理</span><small>{state ? bytes(state.totalBytes) : error ? '读取失败' : '计算中…'}</small><ChevronDown size={14} /></button>
    {open && <div id={contentId} className="audio-cache-content">
      <div className="audio-cache-heading"><strong>声音缓存</strong>
        <button className="launcher-icon" aria-label="缓存说明" aria-expanded={help} onClick={() => setHelp(!help)}><HelpCircle size={14} /></button>
        <button className="launcher-icon" aria-label="刷新缓存容量" disabled={busy} onClick={() => void refresh(false)}><RefreshCw size={14} /></button></div>
      {help && <p>缓存由小录自动回收，清理不会删除原片或改变音质。正在使用的文件会保留。</p>}
      {state && <div className="audio-cache-detail">可清理 {bytes(state.clearableBytes)}{state.inUseBytes > 0 && ` · 使用中 ${bytes(state.inUseBytes)}`}</div>}
      <button className="launcher-menu-row" disabled={busy || !state?.clearableBytes} onClick={() => void refresh(true)}>
        <span>{busy ? '正在检查…' : '清理缓存'}</span></button>
      {message && <div role="status" className="audio-cache-detail">{message}</div>}
      {!!(error || state?.warnings.length) && <div className="launcher-inline-error" role="alert">{error || state?.warnings.join('；')}</div>}
    </div>}
  </section>;
}
