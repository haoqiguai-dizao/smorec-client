import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useWhiteboard } from '../../hooks/useWhiteboard';
import { useWhiteboardCanvas } from '../../hooks/useWhiteboardCanvas';
import { useWhiteboardSpeech } from '../../hooks/useWhiteboardSpeech';
import { useWhiteboardImageImport } from '../../hooks/useWhiteboardImageImport';
import { WhiteboardTools, type BoardTool } from './WhiteboardTools';
import { WhiteboardSpeechStatus } from './WhiteboardSpeechStatus';
import { WhiteboardSelectionMenu } from './WhiteboardSelectionMenu';
import { WhiteboardHeader } from './WhiteboardHeader';
import { WhiteboardCameraBackdrop } from './WhiteboardCameraBackdrop';
import { useWhiteboardBackdrop } from '../../hooks/useWhiteboardBackdrop';
import { boardViewport } from '../../services/whiteboard-renderer';
import { BOARD_COLORS, BOARD_HEADER_HEIGHT, BOARD_TOOLBAR_HEIGHT,
  type BoardAction, type BoardPoint, type BoardShapeKind } from '../../../shared/whiteboard/types';
import type { BoardNode } from '../../../shared/whiteboard/geometry';

interface TextDraft {
  session?: string;
  id: string; gesture: string; node?: BoardNode; color: string; point: BoardPoint;
  value: string; left: number; top: number; scale: number; width: number;
}

export function Whiteboard() {
  const board = useWhiteboard();
  const [tool, setTool] = useState<BoardTool>('pen');
  const [voiceShape, setVoiceShape] = useState<BoardShapeKind>('rectangle');
  const [shapeColor, setShapeColor] = useState<string>(BOARD_COLORS[0]);
  const [lineColor, setLineColor] = useState<string>(BOARD_COLORS[1]);
  const [size, setSize] = useState(6);
  const [eraserDiameter, setEraserDiameter] = useState(48);
  const [textDraft, setText] = useState<TextDraft>();
  const text = textDraft?.session === board.state?.session ? textDraft : undefined;
  const composing = useRef(false);
  const backdrop = useWhiteboardBackdrop(board.scene, board.state, setShapeColor, setLineColor);
  const enabled = board.ready && !!board.state?.available && !!board.state?.visible && !board.state?.sceneBusy && !board.error;
  const color = tool === 'line' || tool === 'arrow' ? lineColor : shapeColor;
  const speech = useWhiteboardSpeech({ session: board.state?.session, enabled, selected: tool === 'voice',
    model: board.state?.speechModel,
    scene: board.scene, color: shapeColor, size, shape: voiceShape, act: board.act, select: id => drawing.setSelected(id) });
  const drawing = useWhiteboardCanvas({ scene: backdrop.scene, tool, color, shapeColor, lineColor,
    size, eraserDiameter, enabled, editingText: !!text, voiceShape, transparent: backdrop.camera || board.state?.windowOptions?.transparent,
    session: board.state?.session,
    act: board.act, onVoiceStart: speech.start, onVoiceEnd: () => { void speech.end(); },
    onVoiceCancel: speech.cancel, onSelectExisting: () => setTool('select'), onText: (point, node) => {
      const bounds = drawing.canvas.current!.getBoundingClientRect(), v = boardViewport(bounds.width, bounds.height, board.scene.view);
      setText({ session: board.state?.session, id: node?.id ?? crypto.randomUUID(), gesture: crypto.randomUUID(), node, color: node?.color ?? shapeColor,
        point: node ? { x: node.x, y: node.y } : point,
        value: node?.kind === 'image' ? node.caption : node?.text ?? '',
        left: v.left + (node ? node.x + 8 : point.x) * v.scale,
        top: v.top + (node?.kind === 'image' ? node.y + node.height + 5
          : node ? node.y + node.height / 2 - 18 : point.y) * v.scale,
        width: node ? Math.max(40, (node.width - 16) * v.scale) : 420 * v.scale, scale: v.scale });
    } });
  const images = useWhiteboardImageImport({ session: board.state?.session, enabled,
    canvas: drawing.canvas, view: board.scene.view, accept: image => { board.acceptImported(image); setTool('select'); },
    select: drawing.setSelected });
  const selectedItem = backdrop.scene.items.find(item => item.id === drawing.selected);
  const chooseTool = (value: BoardTool) => {
    drawing.finish(); commitText();
    drawing.setSelected(undefined); setTool(value);
  };
  useEffect(() => {
    if (board.state?.visible) drawing.canvas.current?.focus();
  }, [board.state?.visible, drawing.canvas]);
  useEffect(() => {
    document.documentElement.dataset.boardTransparent = String(!!board.state?.windowOptions?.transparent);
    document.documentElement.style.setProperty('--board-background-opacity', String(1 - (board.state?.windowOptions?.transparency ?? 1)));
    return () => { delete document.documentElement.dataset.boardTransparent; document.documentElement.style.removeProperty('--board-background-opacity'); };
  }, [board.state?.windowOptions?.transparent, board.state?.windowOptions?.transparency]);
  const commitText = () => setText(undefined);
  const updateText = (value: string) => {
    if (!text) return;
    setText({ ...text, value });
    if (text.node?.kind === 'image') board.act({ kind: 'replace', gesture: text.gesture, element: { ...text.node, caption: value } });
    else if (text.node) board.act({ kind: 'replace', gesture: text.gesture, element: { ...text.node, text: value } });
    else board.act({ kind: 'text', id: text.id, color: text.color, size: 32, x: text.point.x, y: text.point.y, text: value });
  };
  const action = (value: BoardAction) => { drawing.finish(); commitText(); board.act(value); };
  const hide = () => { drawing.finish(); commitText(); void board.setVisible(false); };
  const keyDown = (event: KeyboardEvent) => {
    if (composing.current || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault();
      if (text) setText(undefined); else if (drawing.selected) drawing.setSelected(undefined);
      else if (backdrop.camera) void board.setBackdrop('white');
      else if (board.state?.maximized) void board.setMaximized(false); else hide(); }
    if (!enabled) return;
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && drawing.selected) {
      event.preventDefault(); action({ kind: 'delete', id: drawing.selected }); drawing.setSelected(undefined); return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); action({ kind: event.shiftKey ? 'redo' : 'undo' });
    }
  };
  const pointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!enabled || board.state?.presentation !== 'interface' || !event.isPrimary || event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    board.act({ kind: 'focus', space: 'window', point: {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    } });
  };
  return <main className={`whiteboard${board.state?.maximized ? ' board-maximized' : ''}${backdrop.camera ? ' board-camera' : ''}`}
    onKeyDown={keyDown} onPointerDownCapture={pointerDown} onPaste={images.pasted} style={{
    '--board-header-height': `${BOARD_HEADER_HEIGHT}px`, '--board-toolbar-height': `${BOARD_TOOLBAR_HEIGHT}px`,
    '--board-control-top': `${board.state?.controlsInsets?.top ?? 8}px`, '--board-control-bottom': `${board.state?.controlsInsets?.bottom ?? 96}px`,
    '--board-control-left': `${board.state?.controlsInsets?.left ?? 8}px`, '--board-control-right': `${board.state?.controlsInsets?.right ?? 8}px`,
  } as CSSProperties}>
    <WhiteboardCameraBackdrop state={board.state} ready={board.ready} />
    <WhiteboardHeader board={board} camera={backdrop.camera} enabled={enabled} tool={tool} viewport={drawing.viewport}
      onCommitText={commitText} onTool={chooseTool} onHide={hide}
      onBackdrop={(value, shade) => { drawing.finish(); commitText(); void board.setBackdrop(value, shade); }}
      onWindowOptions={value => { drawing.finish(); commitText(); void board.setWindowOptions(value); }}
      onRestore={() => { drawing.finish(); commitText();
        if (backdrop.camera) void board.setBackdrop('white'); else void board.setMaximized(!board.state?.maximized); }} />
    <section className={`board-sheet tool-${tool}`} onDrop={images.dropped} onDragOver={images.dragOver}>
      <canvas aria-label="白板书写区" ref={drawing.canvas} {...drawing.handlers} tabIndex={0} />
      {enabled && !text && selectedItem && (selectedItem.kind === 'shape' || selectedItem.kind === 'line')
        && <WhiteboardSelectionMenu item={selectedItem} items={board.scene.items} canvas={drawing.canvas} view={board.scene.view}
          onShape={shape => {
            if (selectedItem.kind === 'shape' && selectedItem.shape !== shape) board.act({ kind: 'replace',
              gesture: crypto.randomUUID(), element: { ...selectedItem, shape } });
          }} onArrow={arrow => {
            if (selectedItem.kind === 'line' && selectedItem.arrow !== arrow) board.act({ kind: 'replace',
              gesture: crypto.randomUUID(), element: { ...selectedItem, arrow } });
          }} />}
      {text && <textarea autoFocus aria-label={text.node?.kind === 'image' ? '图片下方注释' : '白板文字'}
        placeholder={text.node?.kind === 'image' ? '图片说明' : '输入文字'} maxLength={1000} wrap="off"
        value={text.value} style={{ left: text.left, top: text.top, color: text.color,
          fontSize: (text.node?.kind === 'image' ? 18 : text.node ? 25 : 32) * text.scale,
          minHeight: text.node?.kind === 'image' ? 58 * text.scale : undefined,
          height: text.node?.kind === 'image' ? 58 * text.scale : undefined,
          width: `min(${text.width}px, calc(100% - ${text.left}px))` }}
        onChange={event => updateText(event.target.value)} onBlur={commitText}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !composing.current && !event.nativeEvent.isComposing) {
            event.preventDefault(); commitText(); drawing.canvas.current?.focus();
          }
        }} />}
      {board.error && <div className="board-error" role="alert">{board.error}</div>}
      {(images.error || images.busy) && <div className="board-import-status" role="status">
        {images.error ?? '正在添加图片…'}</div>}
      {tool === 'voice' && <WhiteboardSpeechStatus {...speech} model={board.state?.speechModel} />}
    </section>
    <WhiteboardTools camera={backdrop.camera} tool={tool} color={selectedItem?.kind === 'shape' || selectedItem?.kind === 'line'
      ? selectedItem.color : color} size={size} eraserDiameter={eraserDiameter}
      speechSupported={board.state?.speechSupported === true}
      voiceShape={voiceShape} onVoiceShape={setVoiceShape}
      disabled={!enabled} canUndo={!!board.scene.undo.length}
      canRedo={!!board.scene.redo.length} onTool={chooseTool}
      onColor={value => {
        const item = selectedItem;
        const editingLine = item?.kind === 'line'
          || (item?.kind !== 'shape' && (tool === 'line' || tool === 'arrow'));
        if (editingLine) setLineColor(value); else setShapeColor(value);
        if (item && (item.kind === 'shape' || item.kind === 'line')) board.act({ kind: 'replace',
          gesture: crypto.randomUUID(), element: { ...item, color: value } });
      }} onSize={value => {
        setSize(value);
        const item = board.scene.items.find(candidate => candidate.id === drawing.selected);
        if (item && (item.kind === 'shape' || item.kind === 'line')) board.act({ kind: 'replace',
          gesture: crypto.randomUUID(), element: { ...item, size: value } });
      }} onEraserDiameter={setEraserDiameter} onUndo={() => action({ kind: 'undo' })}
      onRedo={() => action({ kind: 'redo' })} onClear={() => action({ kind: 'clear' })}
      onPasteImage={() => { void images.pasteClipboard(); }} />
  </main>;
}
