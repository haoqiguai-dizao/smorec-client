import { AlertCircle, AppWindow, Check, LoaderCircle, Monitor, Scan } from 'lucide-react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { sourceLabel } from './utils';

export function LauncherSources({ model: m, closeOnSelect = true }: { model: RecorderLauncherModel; closeOnSelect?: boolean }) {
  return <>
    <div className="launcher-source-modes" role="group" aria-label="录制范围">
      {([{ id: 'screen', label: '屏幕', icon: Monitor }, { id: 'window', label: '窗口', icon: AppWindow }, { id: 'region', label: '区域', icon: Scan }] as const).map(({ id, label, icon: Icon }) =>
        <button key={id} aria-pressed={m.mode === id} disabled={m.busy} title={id === 'region' ? '拖动鼠标框选区域' : undefined} onClick={() => m.chooseMode(id)}><Icon size={25} /><span>{label}</span></button>)}
    </div>
    <div className="launcher-source-grid" role="group" aria-label="选择录制来源">
      {m.loadingSources && !m.sources.length ? <div className="launcher-empty"><LoaderCircle size={22} className="launcher-spinning" />正在查找录制来源</div> : !m.sources.length ? <div className="launcher-empty"><Monitor size={24} />没有可用{m.mode === 'window' ? '窗口' : '屏幕'}</div> : m.sources.map(source =>
        <button className={`launcher-source ${m.selected?.id === source.id ? 'selected' : ''}`} key={source.id} data-source-id={source.id} aria-pressed={m.selected?.id === source.id} disabled={m.busy}
          onClick={() => { m.selectSource(source.id); if (m.mode !== 'region' && closeOnSelect) m.setPanel(null); }}>
          <span className="launcher-source-image">{source.thumbnail ? <img src={source.thumbnail} alt="" /> : <Monitor size={25} />}</span>
          <span className="launcher-source-details"><span className="launcher-source-name" title={source.name}>{sourceLabel(source, m.sources)}</span><small>{source.width} × {source.height}</small></span>
          {m.selected?.id === source.id && <Check className="launcher-source-check" size={19} />}
        </button>)}
    </div>
    {m.mode === 'region' && <div className={m.cropValid ? 'launcher-region-summary' : 'launcher-inline-error'}>{!m.cropValid && <AlertCircle size={14} />}{m.cropValid ? `已选区域 ${m.crop.width} × ${m.crop.height}` : '请点击「区域」重新框选'}</div>}
  </>;
}
