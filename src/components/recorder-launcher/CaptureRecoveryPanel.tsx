import { Circle, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLauncherPanelDrag } from '../../hooks/useLauncherPanelDrag';
import './permission-guide.css';

export function CaptureRecoveryPanel({ label, close, children }: { label: string; close(): void; children: ReactNode }) {
  const drag = useLauncherPanelDrag();
  return <section className="launcher-panel permission-guide" {...drag} data-toolbar-surface aria-label={label}>
    <header className="permission-guide-chrome"><span className="permission-guide-brand"><Circle size={24} />小录</span>
      <button type="button" aria-label={`关闭${label}`} title="返回原任务" onClick={close}><X size={19} /></button></header>
    <div className="permission-guide-body">{children}</div>
  </section>;
}
