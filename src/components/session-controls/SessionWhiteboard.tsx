import { Presentation } from 'lucide-react';
import { useWhiteboard } from '../../hooks/useWhiteboard';
import { useState } from 'react';
import { ToolbarDevice } from './ToolbarDevice';

export function SessionWhiteboard({ compact = false, onBusy }: { compact?: boolean; onBusy?(value: boolean): void }) {
  const board = useWhiteboard();
  const [pending, setPending] = useState(false);
  const toggle = async () => {
    if (pending) return;
    setPending(true); onBusy?.(true);
    try { if (board.state?.visible) await board.setVisible(false); else await board.chooseMode(); }
    finally { setPending(false); onBusy?.(false); }
  };
  const title = board.error ?? (!board.state?.available ? '白板正在准备' : board.state.visible ? '收起白板' : '打开白板');
  return <ToolbarDevice label="白板" ariaLabel="白板" icon={Presentation} compact={compact} className="session-whiteboard"
    device={{ enabled: !!board.state?.visible, pending, title,
      disabled: !board.state?.available || board.state.presentationBusy, toggle: () => void toggle() }} />;
}
