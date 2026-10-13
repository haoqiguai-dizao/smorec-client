import { AppWindow, ChevronDown, Monitor, Scan } from 'lucide-react';
import type { RecorderLauncherModel } from '../../hooks/useRecorderLauncher';
import { sourceLabel } from './utils';

export function LauncherSourceTrigger({ model: m, readOnly = false }: { model: RecorderLauncherModel; readOnly?: boolean }) {
  const Icon = m.mode === 'window' ? AppWindow : m.mode === 'region' ? Scan : Monitor;
  const label = m.mode === 'region' ? `区域 ${m.crop.width} × ${m.crop.height}` : sourceLabel(m.selected, m.sources) || (m.mode === 'window' ? '选择窗口' : '选择屏幕');
  if (readOnly) return <span className="toolbar-source-readonly" aria-label={`当前采集范围：${label}`} title={label}><Icon size={21} /><span>{label}</span></span>;
  return <button className="launcher-source-trigger" aria-label="选择录制范围" title={label} aria-expanded={m.panel === 'sources'} disabled={m.busy}
    onClick={() => m.setPanel(m.panel === 'sources' ? null : 'sources')}><Icon size={19} /><span>{label}</span><ChevronDown size={13} /></button>;
}
