import { Camera, Focus, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface Range { start: number; end: number }
interface Props {
  kind: 'clip' | 'zoom' | 'composition'; name: string; range: Range; offset: number; total: number;
  min: number; max: number; fps: number; selected: boolean;
  segment?: Range & { offset: number };
  label?: string;
  sourceAt: (clientX: number) => number;
  onSelect: () => void;
  onSeek: (clientX: number) => void;
  onCommit?: (start: number, end: number) => void;
  onPreview?: (range: Range | null) => void;
}
type Mode = 'start' | 'end' | 'move';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function RangeBlock({ kind, name, range, offset, total, min, max, fps, selected, segment, label, sourceAt, onSelect, onSeek, onCommit, onPreview }: Props) {
  const [draft, setDraft] = useState<Range | null>(null);
  const dragging = useRef<{ mode: Mode; origin: number; initial: Range; latest: Range; pointerId: number; target: HTMLElement } | null>(null);
  const preview = useRef(onPreview); preview.current = onPreview;
  useEffect(() => {
    const cancel = () => {
      const drag = dragging.current; if (!drag) return;
      dragging.current = null; setDraft(null); preview.current?.(null);
      if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && dragging.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape); cancel(); };
  }, []);
  const shown = draft ?? range;
  const visibleStart = segment ? Math.max(segment.start, shown.start) : shown.start;
  const visibleEnd = segment ? Math.min(segment.end, shown.end) : shown.end;
  const left = segment ? segment.offset + visibleStart - segment.start : offset + shown.start - range.start;
  const begin = (event: ReactPointerEvent<HTMLElement>, mode: Mode) => {
    if (!onCommit || event.button !== 0) return;
    event.stopPropagation(); event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { mode, origin: sourceAt(event.clientX), initial: { ...range }, latest: { ...range }, pointerId: event.pointerId, target: event.currentTarget };
    onSelect();
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const delta = sourceAt(event.clientX) - drag.origin;
    const quantize = (value: number) => Math.round(value * fps) / fps;
    const next = { ...drag.initial };
    if (drag.mode === 'start') next.start = clamp(quantize(drag.initial.start + delta), min, drag.initial.end - 1 / fps);
    else if (drag.mode === 'end') next.end = clamp(quantize(drag.initial.end + delta), drag.initial.start + 1 / fps, max);
    else { const length = drag.initial.end - drag.initial.start; next.start = clamp(quantize(drag.initial.start + delta), min, max - length); next.end = next.start + length; }
    drag.latest = next; setDraft(next); onPreview?.(next);
  };
  const finish = (event: ReactPointerEvent<HTMLElement>, cancel = false) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragging.current = null; setDraft(null);
    onPreview?.(null);
    if (drag.target.hasPointerCapture(event.pointerId)) drag.target.releasePointerCapture(event.pointerId);
    if (!cancel && (Math.abs(drag.latest.start - range.start) > .00001 || Math.abs(drag.latest.end - range.end) > .00001)) onCommit?.(drag.latest.start, drag.latest.end);
  };
  const startVisible = !segment || range.start >= segment.start;
  const endVisible = !segment || range.end <= segment.end;
  return <div role="button" tabIndex={0} aria-label={name} aria-pressed={selected} data-editor-selection={kind} className={`timeline-${kind} ${selected ? 'selected' : ''} ${draft ? 'is-dragging' : ''}`} style={{ left: `${left / total * 100}%`, width: `${Math.max(0, visibleEnd - visibleStart) / total * 100}%` }} onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); onSelect(); onSeek(event.clientX); if (kind !== 'clip' && onCommit) begin(event, 'move'); }} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.code === 'Space')) { event.preventDefault(); onSelect(); } }}>
    {onCommit && startVisible && <button className="timeline-trim-handle start" aria-label={kind === 'clip' ? '裁剪片段开头' : '调整镜头开始'} title="拖动调整开始" onPointerDown={event => begin(event, 'start')} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}><i /></button>}
    {kind === 'clip' ? <Video size={14} /> : kind === 'composition' ? <Camera size={13} /> : <Focus size={13} />}<span>{name}</span><small>{label ?? `${(shown.end - shown.start).toFixed(1)}s`}</small>
    {onCommit && endVisible && <button className="timeline-trim-handle end" aria-label={kind === 'clip' ? '裁剪片段结尾' : '调整镜头结束'} title="拖动调整结束" onPointerDown={event => begin(event, 'end')} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}><i /></button>}
    {draft && <span className="timeline-drag-tooltip">{shown.start.toFixed(2)} – {shown.end.toFixed(2)}s</span>}
  </div>;
}
