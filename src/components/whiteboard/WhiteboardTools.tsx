import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Ellipsis, Eraser, Mic, MousePointer2, PenLine, Redo2, Shapes, Type, Undo2 } from 'lucide-react';
import { WhiteboardToolOptions, ColorChoices, type BoardPanel } from './WhiteboardToolOptions';
import type { BoardShapeKind } from '../../../shared/whiteboard/types';

export type BoardTool = 'hand' | 'select' | 'pen' | 'eraser' | 'text' | 'voice'
  | 'rectangle' | 'ellipse' | 'diamond' | 'line' | 'arrow';
interface Props {
  camera?: boolean;
  tool: BoardTool; color: string; size: number; eraserDiameter: number;
  disabled: boolean; canUndo: boolean; canRedo: boolean; speechSupported: boolean;
  voiceShape: BoardShapeKind; onVoiceShape: (shape: BoardShapeKind) => void;
  onTool: (tool: BoardTool) => void; onColor: (color: string) => void;
  onSize: (size: number) => void; onEraserDiameter: (size: number) => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void; onPasteImage: () => void;
}
export function WhiteboardTools(p: Props) {
  const [panel, setPanel] = useState<BoardPanel>();
  const root = useRef<HTMLElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const close = () => { setPanel(undefined); trigger.current?.focus(); };
  const toggle = (next: BoardPanel, button: HTMLButtonElement) => {
    trigger.current = button; setPanel(current => current === next ? undefined : next);
  };
  useEffect(() => {
    if (!panel) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPanel(undefined);
    };
    options.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [panel]);
  return <footer className="board-dock">
    <nav ref={root} className="board-tools" aria-label="白板工具" style={{ '--ink-color': p.color } as CSSProperties}
      onKeyDownCapture={event => {
        if (event.key === 'Escape' && panel) { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
      <div className="board-tool-group board-history">
        <button aria-label="撤销" title="撤销 · ⌘/Ctrl+Z" disabled={p.disabled || !p.canUndo} onClick={() => { setPanel(undefined); p.onUndo(); }}><Undo2 size={19} /></button>
        <button aria-label="重做" title="重做 · ⌘/Ctrl+Shift+Z" disabled={p.disabled || !p.canRedo} onClick={() => { setPanel(undefined); p.onRedo(); }}><Redo2 size={19} /></button>
      </div>
      <span className="board-divider" aria-hidden="true" />
      <div className="board-tool-group board-drawing-tools">{([
        ['select', '选择', MousePointer2], ['pen', '画笔', PenLine],
      ] as const).map(([tool, label, Icon]) => <button key={tool} className={`board-tool board-tool-${tool}`}
        title={tool === 'pen' ? `${label} · 再点调整粗细` : label} aria-label={label}
        aria-pressed={p.tool === tool} aria-expanded={tool === 'pen' && p.tool === tool ? panel === 'stroke' : undefined}
        aria-haspopup={tool === 'pen' ? 'dialog' : undefined} disabled={p.disabled} onClick={event => {
          if (p.tool === tool && tool === 'pen') toggle('stroke', event.currentTarget);
          else { setPanel(undefined); p.onTool(tool); }
        }}><Icon size={23} strokeWidth={1.7} />
        {tool === 'pen' && p.tool === tool && <ChevronDown className="board-tool-chevron" size={9} />}
      </button>)}
        <button className="board-tool board-tool-shape" aria-label="形状与连线" title="形状与连线"
          aria-pressed={['rectangle', 'ellipse', 'diamond', 'line', 'arrow'].includes(p.tool)}
          aria-haspopup="dialog" aria-expanded={panel === 'shape'} disabled={p.disabled}
          onClick={event => toggle('shape', event.currentTarget)}><Shapes size={23} strokeWidth={1.7} />
          <ChevronDown className="board-tool-chevron" size={9} /></button>
        {p.speechSupported && <button className="board-tool board-tool-voice" aria-label="按住说话"
          title="按住说话 · 再点选择图形或纯文字" aria-pressed={p.tool === 'voice'} disabled={p.disabled}
          aria-haspopup="dialog" aria-expanded={panel === 'voice'} onClick={event => {
            if (p.tool === 'voice') toggle('voice', event.currentTarget);
            else { setPanel(undefined); p.onTool('voice'); }
          }}><Mic size={23} strokeWidth={1.7} /><ChevronDown className="board-tool-chevron" size={9} /></button>}
        {([
          ['text', '文字', Type], ['eraser', '橡皮', Eraser],
        ] as const).map(([tool, label, Icon]) => <button key={tool} className={`board-tool board-tool-${tool}`}
          title={tool === 'eraser' ? `${label} · 再点调整范围` : label} aria-label={label}
          aria-pressed={p.tool === tool} aria-expanded={tool === 'eraser' && p.tool === tool ? panel === 'stroke' : undefined}
          aria-haspopup={tool === 'eraser' ? 'dialog' : undefined} disabled={p.disabled} onClick={event => {
            if (p.tool === tool && tool === 'eraser') toggle('stroke', event.currentTarget);
            else { setPanel(undefined); p.onTool(tool); }
          }}><Icon size={23} strokeWidth={1.7} />
          {tool === 'eraser' && p.tool === tool && <ChevronDown className="board-tool-chevron" size={9} />}
        </button>)}</div>
      <span className="board-divider" aria-hidden="true" />
      <div className="board-inline-colors"><ColorChoices camera={p.camera} color={p.color} disabled={p.disabled} onColor={p.onColor} /></div>
      <button className="board-color-trigger" aria-label="选择颜色" title="选择颜色" aria-haspopup="dialog"
        aria-expanded={panel === 'colors'} disabled={p.disabled} onClick={event => toggle('colors', event.currentTarget)}>
        <i style={{ backgroundColor: p.color }} />
      </button>
      <button aria-label="更多白板操作" title="更多" aria-haspopup="dialog" aria-expanded={panel === 'more'}
        disabled={p.disabled} onClick={event => toggle('more', event.currentTarget)}><Ellipsis size={22} /></button>
      {panel && <div ref={options} className={`board-options board-options-${panel}`} role="dialog"
        aria-label={panel === 'stroke' ? `${p.tool === 'eraser' ? '橡皮范围' : '线条粗细'}`
          : panel === 'colors' ? '白板颜色' : panel === 'shape' ? '形状与连线' : panel === 'voice' ? '语音生成类型' : '更多白板操作'}>
        <WhiteboardToolOptions camera={p.camera} panel={panel} tool={p.tool} color={p.color} size={p.size}
          eraserDiameter={p.eraserDiameter} disabled={p.disabled}
          voiceShape={p.voiceShape} onVoiceShape={shape => { p.onVoiceShape(shape); close(); }}
          onColor={color => { p.onColor(color); close(); }} onSize={size => { p.onSize(size); close(); }}
          onEraserDiameter={size => { p.onEraserDiameter(size); close(); }}
          onShape={tool => { p.onTool(tool); close(); }}
          onPasteImage={() => { p.onPasteImage(); close(); }}
          onClear={() => { p.onClear(); close(); }} />
      </div>}
    </nav>
  </footer>;
}
