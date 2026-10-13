import { AlertCircle, EyeOff, LoaderCircle } from 'lucide-react';
import type { ToolbarExclusionControl } from './types';

export function ToolbarExclusions({ control, compact = false }: { control: ToolbarExclusionControl; compact?: boolean }) {
  const Icon = control.pending ? LoaderCircle : control.error ? AlertCircle : EyeOff;
  return <button type="button" className={`toolbar-exclusions${control.error ? ' has-error' : ''}`} aria-label="排除应用"
    aria-expanded={control.open} aria-busy={control.pending} title={control.title} disabled={control.disabled}
    onClick={control.toggle} data-toolbar-focus="exclusions">
    <Icon size={21} className={control.pending ? 'launcher-spinning' : undefined} />
    {!compact && <span className="toolbar-exclusions-label">排除</span>}
    <span className="toolbar-exclusions-count">{control.count ?? '—'}</span>
  </button>;
}
