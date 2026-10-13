import { useEffect, useRef, useState } from 'react';

export function CompositionSlider({ label, value, min, max, disabled, formatValue, onPreview, onCommit }: {
  label: string; value: number; min: number; max: number; disabled?: boolean;
  formatValue?: (value: number) => string;
  onPreview: (value: number | null) => void; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number>();
  const dragging = useRef<{ pointerId: number; initial: number; target: HTMLInputElement } | undefined>(undefined);
  const committed = useRef(value); committed.current = value;
  const completedPointer = useRef<number | undefined>(undefined);
  const cancelled = useRef(false);
  const callbacks = useRef({ onPreview, onCommit }); callbacks.current = { onPreview, onCommit };
  const cancel = () => {
    const current = dragging.current; if (!current) return;
    dragging.current = undefined; cancelled.current = true;
    if (current.target.hasPointerCapture(current.pointerId)) current.target.releasePointerCapture(current.pointerId);
    setDraft(undefined); callbacks.current.onPreview(null);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && dragging.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape); cancel(); };
  }, []);
  return <label className="slider-field"><span className="field-top"><span>{label}</span><span className="field-value">{formatValue ? formatValue(draft ?? value) : `${Math.round(draft ?? value)}%`}</span></span>
    <input aria-label={label} type="range" min={min} max={max} step={1} disabled={disabled} value={draft ?? value}
      onPointerDown={event => { if (event.button !== 0) return; cancelled.current = false; completedPointer.current = undefined; event.currentTarget.setPointerCapture(event.pointerId); dragging.current = { pointerId: event.pointerId, initial: value, target: event.currentTarget }; }}
      onKeyDown={event => { if (event.key !== 'Escape') { cancelled.current = false; completedPointer.current = undefined; } }}
      onChange={event => {
        const next = Number(event.target.value);
        if (dragging.current) { setDraft(next); onPreview(next); }
        // Chromium emits a final change after pointerup as well as the live input events.
        else if (!cancelled.current && !(event.nativeEvent.type === 'change' && next === completedPointer.current) && next !== committed.current) { committed.current = next; onCommit(next); }
      }}
      onPointerUp={event => {
        const current = dragging.current; if (!current || current.pointerId !== event.pointerId) return;
        dragging.current = undefined; const next = Number(event.currentTarget.value); setDraft(undefined); onPreview(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        committed.current = next; completedPointer.current = next;
        if (next !== current.initial) onCommit(next);
      }} onPointerCancel={cancel} onLostPointerCapture={cancel} />
  </label>;
}
