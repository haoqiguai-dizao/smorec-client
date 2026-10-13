import { useId, type ReactNode } from 'react';
import { Info } from 'lucide-react';

export function Section({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  const helpId = useId();
  return <section className="inspector-section"><h3>{title}{help && <span className="help-icon"><button aria-label={`${title}说明`} aria-describedby={helpId}><Info size={13} /></button><span id={helpId} role="tooltip" className="help-tooltip">{help}</span></span>}</h3>{children}</section>;
}

export function Slider({ label, value, min, max, step = 1, unit = '', disabled = false, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; disabled?: boolean; onChange: (value: number) => void }) {
  return <label className={`slider-field ${disabled ? 'disabled' : ''}`}><span className="field-top"><span>{label}</span><span className="field-value">{Number(value.toFixed(2))}{unit}</span></span><input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => onChange(Number(e.target.value))} /></label>;
}

export function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className={`toggle-field ${disabled ? 'disabled' : ''}`}><span>{label}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /><span className="toggle-track" /></label>;
}

export function NumberField({ label, value, min, max, step = 0.1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  return <label className="number-field"><span>{label}</span><input type="number" value={Number(value.toFixed(3))} min={min} max={max} step={step} onChange={e => { if (e.target.value !== '') { const next = Number(e.target.value); if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next))); } }} /></label>;
}
