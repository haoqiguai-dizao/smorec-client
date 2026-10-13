import { useEffect, useRef, useState } from 'react';

export function CompositionNumberField({ label, value, min, max, step = .1, unit, onCommit }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onCommit: (value: number) => void;
}) {
  const text = String(Number(value.toFixed(3))), [draft, setDraft] = useState(text);
  const cancelled = useRef(false);
  useEffect(() => setDraft(text), [text]);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < min || next > max) { setDraft(text); return; }
    if (Math.abs(next - value) > .00001) onCommit(next);
  };
  return <label className="composition-number"><span>{label}</span><span><input type="number" aria-label={label} min={min} max={max}
    step={step} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelled.current = true; setDraft(text); event.currentTarget.blur(); } }} />{unit && <small>{unit}</small>}</span></label>;
}
