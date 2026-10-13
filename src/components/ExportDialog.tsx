import { ArrowUpRight, LoaderCircle, Minus } from 'lucide-react';
import { useRef, useSyncExternalStore } from 'react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import type { ExportProgressStore } from '../services/export-progress';

export function ExportDialog({ state, onCancel }: { state: ExportProgressStore; onCancel: () => void }) {
  const { progress, phase } = useSyncExternalStore(state.subscribe, state.getSnapshot);
  const value = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onCancel, '#export-video-action');
  return <div className="modal-backdrop export-backdrop"><section ref={panel} tabIndex={-1} className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title" aria-describedby="export-phase">
    <div className="export-heading"><div className="export-emblem"><ArrowUpRight size={22} /></div><div><h2 id="export-title">正在导出视频</h2><p id="export-phase">{phase || '准备导出'}</p></div>{window.studio && <button className="icon-button export-minimize" aria-label="最小化导出窗口" title="最小化到任务栏，继续导出" onClick={() => window.studio?.minimize()}><Minus size={16} /></button>}</div>
    <div className="export-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}><div style={{ width: `${value * 100}%` }} /></div>
    <div className="export-progress-label"><span><LoaderCircle className="spinning" size={13} />可最小化，导出会继续</span><strong>{Math.round(value * 100)}%</strong></div>
    <button className="button secondary" onClick={onCancel}>取消导出</button>
  </section></div>;
}
