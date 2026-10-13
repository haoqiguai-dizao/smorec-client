import { AlertCircle, Check, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useDistributionSnapshot } from '../../hooks/useDistributionSnapshot';

const visibleStatuses = new Set(['downloading', 'preparing', 'ready', 'deferred', 'error']);

export function DistributionUpdateNotice() {
  const state = useDistributionSnapshot();
  const [actionError, setActionError] = useState('');
  const update = state?.update;
  if (!update || !visibleStatuses.has(update.status)) return null;

  const manualDownload = update.manualDownload;
  const busy = update.status === 'downloading' || update.status === 'preparing';
  const action = manualDownload ? window.distribution?.openDownload : update.status === 'error' ? window.distribution?.check : window.distribution?.restart;
  const label = manualDownload ? '打开官网下载' : update.status === 'ready' || update.status === 'deferred' ? '重启并更新' :
    update.status === 'error' ? '重新检查更新' : update.status === 'downloading' ? '正在下载更新' : '正在准备更新';
  const icon = update.status === 'ready' || update.status === 'deferred' ? <Check size={15} /> :
    update.status === 'error' ? <AlertCircle size={15} /> : <LoaderCircle size={15} className="launcher-spinning" />;
  const title = actionError || update.error || (busy ? '更新完成后可重启小录' : '新版已准备好，点击重启完成更新');
  return <button className={`launcher-update-notice ${update.status === 'error' ? 'error' : ''}`} disabled={busy || !action}
    aria-label={`${label}${update.version ? ` ${update.version}` : ''}`} title={title}
    onClick={() => {
      if (!action) return;
      setActionError('');
      void action().catch(() => setActionError(update.status === 'error' ? '检查更新失败，请稍后重试' : '更新尚未就绪，请稍后重试'));
    }}>
    {icon}<span>{label}</span>
    <small>{busy ? `${update.progress ?? 0}%` : update.version ?? update.currentVersion}</small>
  </button>;
}
