import { GripVertical, LoaderCircle, Square } from 'lucide-react';
import './compact-toolbar.css';

export function CompactToolbar({ label, stopLabel, status = 'recording', stopping = false, disabled = false, onStop, onExpand }: {
  label: string; stopLabel: string; status?: 'recording' | 'live'; stopping?: boolean; disabled?: boolean;
  onStop: () => void; onExpand: () => void;
}) {
  return <section className={`compact-toolbar ${status}`} data-toolbar-surface aria-label={`${status === 'live' ? '投屏' : '录制'}操作栏已收起`}>
    <span className="compact-toolbar-grip" title="拖动操作栏"><GripVertical size={13} /></span>
    <button type="button" className="compact-toolbar-expand" data-toolbar-focus="expand" aria-label="展开操作栏" title="展开操作栏" onClick={onExpand}>
      <i aria-hidden="true" /><span>{label}</span>
    </button>
    <button type="button" className="compact-toolbar-stop" data-toolbar-focus="stop" aria-label={stopLabel} title={stopLabel} disabled={disabled || stopping} aria-busy={stopping} onClick={onStop}>
      {stopping ? <LoaderCircle size={12} className="compact-toolbar-spinning" /> : <Square size={8} fill="currentColor" strokeWidth={0} />}
    </button>
  </section>;
}
