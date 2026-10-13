import { ChevronDown, ChevronUp, LoaderCircle, MoreHorizontal, Square } from 'lucide-react';
import { SessionDevices } from './SessionDevices';
import { SessionWhiteboard } from './SessionWhiteboard';
import type { SessionDevices as Devices } from './types';
import { ToolbarFrame } from './ToolbarFrame';
import type { ReactNode } from 'react';

export function SessionToolbar({ mode, label, time, devices, compact = false, pending = false, toolsOpen = false,
  collapse, expand, tools, stop, onBoardBusy, stopLabel, picture }: {
  mode: 'record' | 'live'; label: string; time: string; devices: Devices; compact?: boolean; pending?: boolean; toolsOpen?: boolean;
  collapse(): void; expand(): void; tools(): void; stop(): void; onBoardBusy?(value: boolean): void;
  stopLabel?: string;
  picture?: ReactNode;
}) {
  const actionLabel = stopLabel ?? (mode === 'record' ? '停止并编辑' : '停止推流');
  return <ToolbarFrame mode={mode} compact={compact} context={
    <span className="session-status"><i aria-hidden="true" /><span><strong>{label}</strong><time>{time}</time></span></span>}>
    {picture}
    <SessionDevices devices={devices} compact={compact} />
    <SessionWhiteboard compact={compact} onBusy={onBoardBusy} />
    {!compact && <button type="button" className="session-more" aria-label="更多设置" title="更多设置" aria-expanded={toolsOpen} disabled={pending} onClick={tools}><MoreHorizontal size={21} /></button>}
    <div className="session-actions">
      <button type="button" className="session-stop" data-toolbar-focus="stop" aria-label={actionLabel} aria-busy={pending} disabled={pending} onClick={stop}>
        {pending ? <LoaderCircle size={15} className="launcher-spinning" /> : <Square size={11} fill="currentColor" />}<span>{compact ? '停止' : actionLabel}</span>
      </button>
    <button type="button" className="session-collapse" data-toolbar-focus="expand" aria-label={compact ? '展开操作栏' : '收起操作栏'} onClick={compact ? expand : collapse}>
      {compact ? <ChevronUp size={17} /> : <ChevronDown size={17} />}<span>{compact ? '展开' : '收起'}</span>
    </button>
    </div>
  </ToolbarFrame>;
}
