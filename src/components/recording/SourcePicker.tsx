import { AppWindow, Check, Monitor } from 'lucide-react';
import type { CaptureSource } from '../../../shared/types';

export function SourcePicker({ sources, selectedId, busy, onSelect }: { sources: CaptureSource[]; selectedId?: string; busy: boolean; onSelect: (id: string) => void }) {
  return <div className="recorder-source-grid" role="listbox" aria-label="录制来源">{sources.map(source => <button key={source.id} data-source-id={source.id} role="option" aria-selected={source.id === selectedId} className={`recorder-source-card ${source.id === selectedId ? 'selected' : ''}`} disabled={busy} onClick={() => onSelect(source.id)}>
    <span className="recorder-source-image">{source.thumbnail ? <img src={source.thumbnail} alt="" /> : source.kind === 'window' ? <AppWindow size={29} strokeWidth={1.3} /> : <Monitor size={29} strokeWidth={1.3} />}{source.id === selectedId && <span className="source-check"><Check size={12} /></span>}</span>
    <span className="recorder-source-caption"><strong>{source.name}</strong><small>{source.width} × {source.height}</small></span>
  </button>)}</div>;
}
