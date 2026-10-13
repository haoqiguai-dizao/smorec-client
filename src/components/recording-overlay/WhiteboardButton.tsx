import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, Presentation } from 'lucide-react';
import { useWhiteboard } from '../../hooks/useWhiteboard';

export function WhiteboardButton({ onBusy, launcher = false }: { onBusy: (busy: boolean) => void; launcher?: boolean }) {
  const board = useWhiteboard();
  const [pending, setPending] = useState(false), [error, setError] = useState<string>();
  const changing = useRef(false);
  const busy = pending || !!board.state?.presentationBusy;
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  const change = async (action: () => Promise<unknown> | undefined) => {
    if (changing.current || board.state?.presentationBusy) return;
    changing.current = true;
    setPending(true); setError(undefined);
    try { await action(); }
    catch (cause) { setError(String(cause)); }
    finally { changing.current = false; setPending(false); }
  };
  const warning = error ?? board.error;
  const mode = board.state?.backdrop === 'camera' ? '摄像头界面' : board.state?.presentation === 'interface' ? '完整界面' : '纯画布';
  return <>
    <button className={launcher ? 'launcher-mode' : undefined} aria-label="白板" title={warning ?? '打开或收起白板'} disabled={!board.state?.available || busy}
      aria-pressed={!!board.state?.visible} onClick={() => void change(() => board.state?.visible ? board.setVisible(false) : board.chooseMode())}><Presentation size={18} />{launcher && <span>白板</span>}</button>
    {board.state && <button className="whiteboard-mode-button" aria-label="白板录制模式" aria-haspopup="menu"
      title={warning ?? `白板录制模式：${mode}`} disabled={!board.state.available || busy}
      onClick={() => void change(() => window.whiteboard?.chooseMode ? board.chooseMode() : window.whiteboard?.choosePresentation())}>
      {launcher && <span>{mode}</span>}
      {warning ? <AlertCircle size={13} /> : <ChevronDown size={13} />}</button>}
  </>;
}
