import { Circle, GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import './session-toolbar.css';

/** Preparation and active sessions share one material, rhythm and control row. */
export function ToolbarFrame({ mode, compact = false, preparation = false, context, notice, children }: {
  mode: 'record' | 'live'; compact?: boolean; preparation?: boolean;
  context: ReactNode; notice?: ReactNode; children: ReactNode;
}) {
  const label = `${mode === 'record' ? '录屏' : '直播'}${preparation ? '准备' : ''}操作栏${compact ? '已收起' : ''}`;
  return <section className={`session-toolbar ${mode}${preparation ? ' is-preparation' : ''}${compact ? ' is-compact' : ''}`}
    data-toolbar-surface aria-label={label}>
    <span className="session-grip" title="拖动操作栏"><GripVertical size={17} /></span>
    {!compact && <span className="session-brand"><Circle size={24} /><strong>小录</strong>{notice}</span>}
    {context}
    {children}
  </section>;
}
