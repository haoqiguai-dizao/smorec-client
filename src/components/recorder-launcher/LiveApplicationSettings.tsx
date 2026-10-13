import { AppWindow, Info, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { LiveApplicationsModel } from '../../hooks/useLiveApplications';

export function LiveApplicationSettings({ applications, disabled, recording = false, compact = false, close }: {
  applications: LiveApplicationsModel; disabled: boolean; recording?: boolean; compact?: boolean; close?(): void;
}) {
  const explanation = recording
    ? '勾选后，该应用不进入屏幕或区域录制。录制中可以增减；新开或重新显示窗口后点击刷新。更新完成后勾选才生效；窗口录制不能排除正在录制的窗口。'
    : '勾选后，该应用的窗口不出现在屏幕或区域投屏中。投屏中可直接调整；应用新开或重新显示窗口后点击刷新。窗口投屏只显示所选窗口。';
  return <section className={`launcher-live-applications${compact ? ' is-toolbar-panel' : ''}`} aria-label="排除应用">
    <header className={compact ? 'launcher-panel-header' : undefined}>
      {compact ? <h1>排除应用 <small>{applications.ready || applications.applying ? applications.selected.length : '—'}</small></h1>
        : <strong>已排除 {applications.selected.length} 个应用</strong>}
      <span className="launcher-live-info" tabIndex={0} aria-label={explanation} title={explanation}><Info size={13} /></span>
      <button type="button" className="launcher-icon" aria-label="刷新排除应用" title="刷新应用" disabled={disabled || applications.loading || applications.applying}
        onClick={() => void applications.refresh()}>{applications.loading || applications.applying ? <LoaderCircle size={14} className="launcher-spinning" /> : <RefreshCw size={14} />}</button>
      {close && <button type="button" className="launcher-icon" aria-label="收起设置" onClick={close}><X size={16} /></button>}
    </header>
    <div className="launcher-live-application-list">
      {applications.choices.map(application => <label key={application.id} title={application.id}>
        <input type="checkbox" checked={applications.includes(application.id)} disabled={disabled || applications.loading || applications.applying || !applications.ready}
          onChange={event => void applications.toggle(application, event.target.checked)} />
        {compact && <AppWindow size={17} aria-hidden="true" />}<span>{application.name}</span>{!application.running && <small>未运行</small>}
      </label>)}
      {!applications.loading && applications.ready && !applications.choices.length && <span className="launcher-live-application-empty">暂无可选应用</span>}
    </div>
    {applications.error && <div className="launcher-inline-error" role="alert">{applications.error}
      <button type="button" disabled={disabled || applications.loading || applications.applying} onClick={() => void applications.refresh()}>重试</button>
    </div>}
  </section>;
}
