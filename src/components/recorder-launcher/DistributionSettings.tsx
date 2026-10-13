import { useState } from 'react';
import { Info, RefreshCw } from 'lucide-react';
import { useDistributionSnapshot } from '../../hooks/useDistributionSnapshot';
const labels = { unconfigured: '更新服务尚未配置', idle: '检查更新', checking: '正在检查更新',
  downloading: '正在下载更新', preparing: '正在准备更新', ready: '重启并更新', deferred: '重试更新', installing: '正在切换新版', error: '重新检查更新' };
export function DistributionSettings() {
  const state = useDistributionSnapshot();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  if (!window.distribution) return null;
  const working = !state || ['checking', 'downloading', 'preparing', 'installing', 'unconfigured'].includes(state.update.status);
  const manualDownload = state?.update.manualDownload;
  const canRestart = state && !manualDownload && ['ready', 'deferred'].includes(state.update.status);
  return <div className="launcher-more-settings" aria-label="更新与使用统计">
    <button className="launcher-menu-row" disabled={working} title={state?.update.error ?? '后台准备好新版后，重启即可完成更新'}
      onClick={() => {
        setError('');
        void (manualDownload ? window.distribution!.openDownload?.() : canRestart ? window.distribution!.restart() : window.distribution!.check())
          ?.catch(() => setError(canRestart ? '更新尚未就绪，请重新检查更新' : '检查更新失败'));
      }}>
      <RefreshCw size={16} /><span>{manualDownload ? '打开官网下载页' : state ? labels[state.update.status] : '正在读取版本'}</span>
      <small>{state?.update.status === 'downloading' ? `${state.update.progress ?? 0}%`
        : state?.update.version ? `${state.update.currentVersion} → ${state.update.version}` : state?.update.currentVersion}</small>
    </button>
    {state && ['deferred', 'error'].includes(state.update.status) && <div className="launcher-inline-error" role="status">{state.update.error}</div>}
    <div className="launcher-setting-row"><label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
      <input type="checkbox" checked={state?.telemetry.enabled ?? false} disabled={!state || saving} onChange={event => {
        setSaving(true); setError('');
        void window.distribution!.setTelemetry(event.target.checked).then(() => {})
          .catch(() => setError('统计设置未保存')).finally(() => setSaving(false));
      }} />帮助改进小录</label>
      <span tabIndex={0} role="img" aria-label="使用统计说明" title="自愿发送启动、录屏和投屏的次数、时长及结果，使用随机安装标识。服务端通过 IP 离线解析大致省市，不保存原始 IP。不发送屏幕、声音、输入内容或软件列表。关闭后停止发送并清除待发送事件。"><Info size={15} /></span>
    </div>
    {window.distribution.openLicenses && <button className="launcher-menu-row" onClick={() => {
      void window.distribution!.openLicenses!().catch(() => setError('无法打开第三方许可目录'));
    }}><Info size={16} /><span>第三方许可与源码</span></button>}
    {error && <div className="launcher-inline-error" role="alert">{error}</div>}
  </div>;
}
