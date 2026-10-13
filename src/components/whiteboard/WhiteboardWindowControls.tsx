import { ChevronDown, Layers2, MousePointer2, Pin, PinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BoardWindowOptions } from '../../../shared/whiteboard/types';

export function WhiteboardWindowControls({ options, disabled, transparencySupported = true, demoVisible, camera = false, onChange }: {
  options?: BoardWindowOptions; disabled: boolean; transparencySupported?: boolean; demoVisible?: boolean; camera?: boolean;
  onChange: (value: Partial<BoardWindowOptions>) => void;
}) {
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLSpanElement>(null);
  const percentage = options?.transparent ? Math.round((options.transparency ?? 1) * 100) : 0;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    };
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <div className="board-window-tools" role="group" aria-label="白板窗口">
    <button title="白板置顶" aria-label="白板置顶" aria-pressed={!!options?.pinned} disabled={disabled}
      onClick={() => onChange({ pinned: !options?.pinned })}>{options?.pinned ? <Pin size={15} /> : <PinOff size={15} />}</button>
    <span className="board-transparency-control" ref={popup}>
    <button title={transparencySupported ? demoVisible ? '演示模式 · 按实际透明度录下界面' : camera ? '本地透明 · 透过窗口临摹下层界面，成片保留摄像头与蒙版' : '本地透明 · 纯画布回放和导出白底' : '当前完整界面不支持本地透明'}
      aria-label="本地透明" aria-pressed={!!options?.transparent} disabled={disabled || !transparencySupported}
      onClick={() => onChange({ transparent: !options?.transparent, transparency: options?.transparency || 1 })}><Layers2 size={15} /></button>
    <button className="board-transparency-chevron" aria-label="调整白板透明度" title="调整透明度" aria-expanded={open}
      disabled={disabled || !transparencySupported} onClick={() => setOpen(!open)}><ChevronDown size={12} /></button>
    {open && !disabled && <div className="board-transparency-popover" role="dialog" aria-label="白板透明度">
      <label htmlFor="board-transparency">透明度<output>{percentage}%</output></label>
      <input id="board-transparency" aria-label="白板透明度" type="range" min={0} max={100} step={5} value={percentage}
        onChange={event => { const value = Number(event.target.value); onChange({ transparent: value > 0, transparency: value / 100 }); }} />
    </div>}
    </span>
    <button title="操作下层应用 · Ctrl/⌘+Shift+B 返回书写" aria-label="操作下层应用" disabled={disabled}
      onClick={() => onChange({ passthrough: true })}><MousePointer2 size={15} /></button>
  </div>;
}
