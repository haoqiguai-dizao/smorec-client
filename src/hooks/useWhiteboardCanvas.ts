import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { attached, elementAt, shapeAt, type BoardNode } from '../../shared/whiteboard/geometry';
import type { BoardScene } from '../../shared/whiteboard/model';
import { BOARD_WORLD_LIMIT, type BoardAction, type BoardElement, type BoardEndpoint,
  type BoardLine, type BoardPoint, type BoardShape } from '../../shared/whiteboard/types';
import { boardViewport, paintBoard } from '../services/whiteboard-renderer';
import { connectionPort, edgeAt, handleAt, handleCursor, paintSelection,
  type BoardHandle } from '../services/whiteboard-selection';
import { drawnLine, drawnShape, movedElement, placedRectangle, resizedImage, resizedShape } from './whiteboard-gestures';
import { prepareSceneImages } from '../services/whiteboard-images';
import { useWhiteboardViewport } from './useWhiteboardViewport';
import type { BoardTool } from '../components/whiteboard/WhiteboardTools';
import { boardRevealAt } from '../../shared/whiteboard/motion';
import { useWhiteboardReveal } from './useWhiteboardReveal';

interface Options {
  scene: BoardScene; tool: BoardTool; color: string; shapeColor: string; lineColor: string;
  size: number; eraserDiameter: number; enabled: boolean; session?: string;
  act: (action: BoardAction) => void; onText: (point: BoardPoint, shape?: BoardNode) => void;
  onSelectExisting: () => void;
  onVoiceStart: (point: BoardPoint, shape?: BoardShape) => void;
  onVoiceEnd: () => void; onVoiceCancel: () => void;
  editingText?: boolean; transparent?: boolean; voiceShape?: BoardShape['shape'];
}
type Active =
  | { kind: 'voice'; pointer: number; start: BoardPoint; shape?: BoardShape; started: boolean }
  | { kind: 'line-tap'; pointer: number; start: BoardPoint; line: BoardLine; color: string; size: number }
  | { kind: 'stroke'; id: string; color: string; size: number; pointer: number; points: BoardPoint[] }
  | { kind: 'erase'; gesture: string; pointer: number; radius: number; last: BoardPoint; points: BoardPoint[] }
  | { kind: 'shape'; id: string; pointer: number; start: BoardPoint; lastSent: string; lastAt: number }
  | { kind: 'line'; id: string; pointer: number; start: BoardPoint; attachedStart: BoardEndpoint;
      arrow: boolean; color: string; size: number; snapMargin: number; threshold: number;
      fromPort: boolean; created: boolean; lastSent: string; lastAt: number }
  | { kind: 'transform'; pointer: number; start: BoardPoint; original: BoardElement; handle?: BoardHandle;
      gesture: string; lastSent: string; lastAt: number };

const isShape = (tool: BoardTool) => tool === 'rectangle' || tool === 'ellipse' || tool === 'diamond';
const isLine = (tool: BoardTool) => tool === 'line' || tool === 'arrow';
const clamp = (value: number, max: number) => Math.max(-BOARD_WORLD_LIMIT, Math.min(max, value));

export function useWhiteboardCanvas(options: Options) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(options); current.current = options;
  const [selection, setSelection] = useState<{ session?: string; id?: string }>();
  const selected = selection?.session === options.session ? selection?.id : undefined;
  const setSelected = (id?: string) => setSelection({ session: current.current.session, id });
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const active = useRef<Active | undefined>(undefined);
  const draft = useRef<BoardElement | undefined>(undefined);
  const hover = useRef<BoardPoint | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const voiceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const paintRef = useRef<() => void>(() => {});
  const paint = () => {
    const target = canvas.current;
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    const density = Math.min(window.devicePixelRatio || 1, 2560 / Math.max(1, bounds.width, bounds.height),
      Math.sqrt(2560 * 1440 / Math.max(1, bounds.width * bounds.height)));
    const width = Math.max(1, Math.round(bounds.width * density)), height = Math.max(1, Math.round(bounds.height * density));
    if (target.width !== width || target.height !== height) { target.width = width; target.height = height; }
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(density, 0, 0, density, 0, 0);
    const scene = current.current.scene, preview = draft.current;
    const items = preview ? scene.items.some(item => item.id === preview.id)
      ? scene.items.map(item => item.id === preview.id ? preview : item) : [...scene.items, preview] : scene.items;
    const time = current.current.enabled ? performance.now() / 1000 : Infinity;
    paintBoard(ctx, { ...scene, items }, bounds.width, bounds.height, current.current.session, current.current.transparent, time);
    const view = boardViewport(bounds.width, bounds.height, scene.view);
    ctx.save(); ctx.translate(view.left, view.top); ctx.scale(view.scale, view.scale);
    const selectedItem = items.find(item => item.id === selectedRef.current);
    const revealing = selectedItem && (selectedItem.kind === 'shape' || selectedItem.kind === 'line')
      && boardRevealAt(selectedItem, scene.reveals?.[selectedItem.id], time);
    if (selectedItem && !revealing && (current.current.tool === 'select' || current.current.tool === 'voice' || isShape(current.current.tool))) {
      paintSelection(ctx, selectedItem, items, view.scale);
    }
    if (current.current.tool === 'eraser' && hover.current) {
      ctx.beginPath(); ctx.arc(hover.current.x, hover.current.y,
        current.current.eraserDiameter / (2 * view.scale), 0, Math.PI * 2);
      ctx.fillStyle = '#3074e81a'; ctx.strokeStyle = '#3074e8'; ctx.lineWidth = 1.5 / view.scale;
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  };
  paintRef.current = paint;
  useWhiteboardReveal(options.scene, options.enabled, paintRef);
  useEffect(() => {
    clearTimeout(timer.current); clearTimeout(voiceTimer.current);
    active.current = undefined; draft.current = undefined; hover.current = undefined; selectedRef.current = undefined;
  }, [options.session]);
  useEffect(() => { paintRef.current(); }, [options.scene, selected, options.tool, options.eraserDiameter, options.transparent]);
  useEffect(() => {
    if (!options.session) return;
    void prepareSceneImages(options.session, options.scene.items.filter(item => item.kind === 'image'))
      .then(() => paintRef.current()).catch(() => undefined);
  }, [options.session, options.scene]);
  useEffect(() => { if (canvas.current) canvas.current.style.cursor = ''; }, [options.tool]);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const observer = new ResizeObserver(() => paintRef.current()); observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(voiceTimer.current); }, []);
  const point = (event: PointerEvent<HTMLCanvasElement> | MouseEvent<HTMLCanvasElement>): BoardPoint => {
    const b = event.currentTarget.getBoundingClientRect(), v = boardViewport(b.width, b.height, current.current.scene.view);
    return { x: clamp((event.clientX - b.left - v.left) / v.scale, BOARD_WORLD_LIMIT),
      y: clamp((event.clientY - b.top - v.top) / v.scale, BOARD_WORLD_LIMIT) };
  };
  const flush = () => {
    clearTimeout(timer.current); timer.current = undefined;
    const gesture = active.current;
    if (gesture?.kind === 'stroke' && gesture.points.length) {
      current.current.act({ kind: 'stroke', id: gesture.id, color: gesture.color,
        size: gesture.size, points: gesture.points.splice(0) });
    }
    if (gesture?.kind === 'erase' && gesture.points.length) {
      current.current.act({ kind: 'erase', id: crypto.randomUUID(), gesture: gesture.gesture,
        radius: gesture.radius, points: gesture.points.splice(0) });
    }
  };
  const finish = () => {
    const gesture = active.current;
    clearTimeout(voiceTimer.current); voiceTimer.current = undefined;
    if (gesture?.kind === 'voice' && gesture.started) current.current.onVoiceCancel();
    flush();
    if (gesture && gesture.kind !== 'stroke' && gesture.kind !== 'erase' && gesture.kind !== 'voice'
      && gesture.kind !== 'line-tap' && draft.current
      && (gesture.kind !== 'line' || gesture.created)) {
      const value = JSON.stringify(draft.current);
      if (value !== gesture.lastSent) {
        if (gesture.kind === 'transform') current.current.act({ kind: 'replace', gesture: gesture.gesture, element: draft.current });
        else current.current.act(draft.current);
      }
    }
    active.current = undefined; draft.current = undefined; paintRef.current();
  };
  const updateDraft = (gesture: Extract<Active, { kind: 'shape' | 'line' | 'transform' }>, p: BoardPoint, click = false) => {
    const options = current.current, items = options.scene.items;
    let element: BoardElement;
    if (gesture.kind === 'shape') {
      element = drawnShape(gesture.id, options.tool as BoardShape['shape'], gesture.start, p,
        options.color, options.size, click);
    } else if (gesture.kind === 'line') {
      if (!gesture.created && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) < gesture.threshold) return;
      element = drawnLine(gesture.id, gesture.attachedStart!, p, items,
        gesture.arrow, gesture.color, gesture.size, click, gesture.snapMargin);
    } else if (gesture.original.kind === 'image' && gesture.handle && !connectionPort(gesture.handle)) {
      element = resizedImage(gesture.original, gesture.handle, p);
    } else if (gesture.original.kind === 'shape' && gesture.handle && gesture.handle !== 'start' && gesture.handle !== 'end') {
      element = resizedShape(gesture.original, gesture.handle, p);
    } else if (gesture.original.kind === 'line' && (gesture.handle === 'start' || gesture.handle === 'end')) {
      const other = gesture.handle === 'start' ? gesture.original.end : gesture.original.start;
      const snapped = attached(p, items);
      element = { ...gesture.original, [gesture.handle]: snapped.shapeId && snapped.shapeId === other.shapeId ? p : snapped };
    } else element = movedElement(gesture.original, p.x - gesture.start.x, p.y - gesture.start.y);
    draft.current = element; paintRef.current();
    const encoded = JSON.stringify(element);
    if (encoded !== gesture.lastSent && (click || Date.now() - gesture.lastAt >= 40)) {
      if (gesture.kind === 'transform') options.act({ kind: 'replace', gesture: gesture.gesture, element });
      else options.act(click && element.kind === 'line' ? { kind: 'reveal', element } : element);
      if (gesture.kind === 'line') gesture.created = true;
      gesture.lastSent = encoded; gesture.lastAt = Date.now();
    }
  };
  const startTransform = (event: PointerEvent<HTMLCanvasElement>, p: BoardPoint, item: BoardElement, handle?: BoardHandle) => {
    setSelected(item.id); selectedRef.current = item.id;
    active.current = { kind: 'transform', pointer: event.pointerId, start: p, original: item,
      handle, gesture: crypto.randomUUID(), lastSent: JSON.stringify(item), lastAt: Date.now() };
    event.currentTarget.setPointerCapture(event.pointerId); paintRef.current();
  };
  const startConnection = (event: PointerEvent<HTMLCanvasElement>, p: BoardPoint,
    shape: BoardNode, handle: BoardHandle, scale: number) => {
    const port = connectionPort(handle);
    if (!port) return;
    const start = { ...p, shapeId: shape.id, port };
    active.current = { kind: 'line', id: crypto.randomUUID(), pointer: event.pointerId,
      start: p, attachedStart: start, arrow: true, color: current.current.lineColor,
      size: current.current.size, snapMargin: 12 / scale, threshold: 6 / scale,
      fromPort: true, created: false, lastSent: '', lastAt: 0 };
    event.currentTarget.style.cursor = 'crosshair';
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const viewport = useWhiteboardViewport({ session: options.session, canvas, enabled: options.enabled && !options.editingText, hand: options.tool === 'hand',
    view: options.scene.view, items: options.scene.items, act: options.act, finish, drawing: () => !!active.current });
  return { canvas, selected, setSelected, finish: () => { viewport.finish(); finish(); }, viewport, handlers: {
    onPointerDown: (event: PointerEvent<HTMLCanvasElement>) => {
      if (viewport.pointerDown(event)) return;
      if (!current.current.enabled || event.button !== 0 || active.current) return;
      const p = point(event), { scene, tool, color, size } = current.current;
      const v = boardViewport(event.currentTarget.clientWidth, event.currentTarget.clientHeight, current.current.scene.view);
      const tolerance = 10 / v.scale;
      const line = (tool === 'pen' || tool === 'text' || tool === 'voice') && !shapeAt(scene.items, p)
        ? elementAt(scene.items, p, tolerance) : undefined;
      if (tool === 'text') {
        if (line?.kind === 'line') {
          current.current.onSelectExisting(); startTransform(event, p, line); return;
        }
        event.preventDefault(); current.current.onText(p, shapeAt(scene.items, p)); return;
      }
      if (tool === 'voice') {
        const chosen = scene.items.find(item => item.id === selectedRef.current);
        const handle = chosen
          ? handleAt(chosen, scene.items, p, tolerance, v.scale) ?? edgeAt(chosen, p, tolerance) : undefined;
        if (chosen && (chosen.kind === 'shape' || chosen.kind === 'image') && handle && connectionPort(handle)) {
          startConnection(event, p, chosen, handle, v.scale); return;
        }
        if (chosen && handle) {
          startTransform(event, p, chosen, handle); return;
        }
        if (line?.kind === 'line') {
          startTransform(event, p, line); return;
        }
        const shape = shapeAt(scene.items, p);
        setSelected(shape?.id); selectedRef.current = shape?.id;
        if (shape?.kind === 'image') { startTransform(event, p, shape); return; }
        active.current = { kind: 'voice', pointer: event.pointerId, start: p, shape, started: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        voiceTimer.current = setTimeout(() => {
          const gesture = active.current;
          if (gesture?.kind !== 'voice' || gesture.pointer !== event.pointerId) return;
          gesture.started = true; current.current.onVoiceStart(p, shape);
        }, 280);
        paintRef.current(); return;
      }
      if (tool === 'select' || isShape(tool) || isLine(tool)) {
        const chosen = scene.items.find(item => item.id === selectedRef.current);
        const handle = chosen && (tool === 'select' || isShape(tool))
          ? handleAt(chosen, scene.items, p, tolerance, v.scale) ?? edgeAt(chosen, p, tolerance) : undefined;
        if (!isLine(tool) && chosen && (chosen.kind === 'shape' || chosen.kind === 'image') && handle && connectionPort(handle)) {
          startConnection(event, p, chosen, handle, v.scale); return;
        }
        const hit = handle ? chosen : elementAt(scene.items, p, tolerance);
        if (hit && (tool === 'select' || hit.kind === 'line'
          || (isShape(tool) && (hit.kind === 'shape' || hit.kind === 'image')))) {
          if (hit.kind === 'line' && tool !== 'select') current.current.onSelectExisting();
          startTransform(event, p, hit, handle); return;
        }
        setSelected(undefined); selectedRef.current = undefined;
        if (tool === 'select') return;
      }
      if (tool === 'pen' && line?.kind === 'line') {
        active.current = { kind: 'line-tap', pointer: event.pointerId, start: p, line, color, size };
        event.currentTarget.setPointerCapture(event.pointerId); return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      if (isShape(tool) || isLine(tool)) {
        const id = crypto.randomUUID(), line = isLine(tool), start = line ? attached(p, scene.items) : undefined;
        const initial = line ? drawnLine(id, start!, { x: clamp(p.x + 24, BOARD_WORLD_LIMIT), y: p.y }, scene.items,
          tool === 'arrow', color, size) : drawnShape(id, tool as BoardShape['shape'], p,
            { x: clamp(p.x + 24, BOARD_WORLD_LIMIT), y: clamp(p.y + 24, BOARD_WORLD_LIMIT) }, color, size);
        current.current.act(initial); draft.current = initial;
        active.current = line
          ? { kind: 'line', id, pointer: event.pointerId, start: p, attachedStart: start!,
            arrow: tool === 'arrow', color, size, snapMargin: 0, threshold: 0,
            fromPort: false, created: true, lastSent: JSON.stringify(initial), lastAt: Date.now() }
          : { kind: 'shape', id, pointer: event.pointerId, start: p,
            lastSent: JSON.stringify(initial), lastAt: Date.now() };
        setSelected(id); selectedRef.current = id; paintRef.current(); return;
      }
      if (tool === 'eraser') {
        const radius = current.current.eraserDiameter / (2 * v.scale);
        active.current = { kind: 'erase', pointer: event.pointerId, gesture: crypto.randomUUID(),
          radius, last: p, points: [p] };
        hover.current = p; flush(); paintRef.current(); return;
      }
      active.current = { kind: 'stroke', id: crypto.randomUUID(), pointer: event.pointerId,
        color, size, points: [p] };
      flush();
    },
    onPointerMove: (event: PointerEvent<HTMLCanvasElement>) => {
      if (viewport.pointerMove(event)) return;
      const p = point(event), gesture = active.current;
      if (current.current.tool === 'eraser') { hover.current = p; paintRef.current(); }
      if (!gesture) {
        const { scene, tool } = current.current;
        const chosen = scene.items.find(item => item.id === selectedRef.current);
        const v = boardViewport(event.currentTarget.clientWidth, event.currentTarget.clientHeight, current.current.scene.view);
        const handle = chosen && (tool === 'select' || tool === 'voice' || isShape(tool))
          ? handleAt(chosen, scene.items, p, 10 / v.scale, v.scale)
            ?? edgeAt(chosen, p, 10 / v.scale) : undefined;
        const overLine = tool !== 'eraser' && !shapeAt(scene.items, p)
          && elementAt(scene.items, p, 10 / v.scale)?.kind === 'line';
        event.currentTarget.style.cursor = handleCursor(handle)
          ?? (overLine ? 'pointer' : tool === 'voice' && shapeAt(scene.items, p) ? 'grab'
            : tool === 'select' ? 'default' : '');
        return;
      }
      if (gesture.pointer !== event.pointerId) return;
      if (gesture.kind === 'line-tap') {
        const v = boardViewport(event.currentTarget.clientWidth, event.currentTarget.clientHeight, current.current.scene.view);
        if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) * v.scale >= 6) {
          setSelected(undefined); selectedRef.current = undefined;
          active.current = { kind: 'stroke', id: crypto.randomUUID(), pointer: gesture.pointer,
            color: gesture.color, size: gesture.size, points: [gesture.start, p] };
          flush();
        }
        return;
      }
      if (gesture.kind === 'voice') {
        const v = boardViewport(event.currentTarget.clientWidth, event.currentTarget.clientHeight, current.current.scene.view);
        const distance = Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) * v.scale;
        if (gesture.shape && distance > (gesture.started ? 18 : 6)) {
          clearTimeout(voiceTimer.current); voiceTimer.current = undefined;
          if (gesture.started) current.current.onVoiceCancel();
          const moving: Extract<Active, { kind: 'transform' }> = {
            kind: 'transform', pointer: gesture.pointer, start: gesture.start, original: gesture.shape,
            gesture: crypto.randomUUID(), lastSent: JSON.stringify(gesture.shape), lastAt: 0,
          };
          active.current = moving;
          event.currentTarget.style.cursor = 'grabbing';
          updateDraft(moving, p);
        } else if (!gesture.shape && distance > 12 && !gesture.started) finish();
        return;
      }
      if (gesture.kind === 'stroke') gesture.points.push(p);
      else if (gesture.kind === 'erase') {
        const distance = Math.hypot(p.x - gesture.last.x, p.y - gesture.last.y);
        const steps = Math.max(1, Math.ceil(distance / Math.max(2, gesture.radius / 2)));
        for (let i = 1; i <= steps; i++) gesture.points.push({ x: gesture.last.x + (p.x - gesture.last.x) * i / steps,
          y: gesture.last.y + (p.y - gesture.last.y) * i / steps });
        gesture.last = p;
      } else { updateDraft(gesture, p); return; }
      if (gesture.points.length >= 128) flush();
      else timer.current ??= setTimeout(flush, 32);
    },
    onPointerUp: (event: PointerEvent<HTMLCanvasElement>) => {
      if (viewport.pointerUp(event)) return;
      const gesture = active.current;
      if (!gesture || gesture.pointer !== event.pointerId) return;
      if (gesture.kind === 'line-tap') {
        const p = point(event), v = boardViewport(event.currentTarget.clientWidth, event.currentTarget.clientHeight, current.current.scene.view);
        if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) * v.scale >= 6) {
          current.current.act({ kind: 'stroke', id: crypto.randomUUID(), color: gesture.color,
            size: gesture.size, points: [gesture.start, p] });
          finish(); event.currentTarget.style.cursor = ''; return;
        }
        current.current.onSelectExisting();
        setSelected(gesture.line.id); selectedRef.current = gesture.line.id;
        finish(); event.currentTarget.style.cursor = ''; return;
      }
      if (gesture.kind === 'voice') {
        clearTimeout(voiceTimer.current); voiceTimer.current = undefined;
        if (gesture.started) { gesture.started = false; current.current.onVoiceEnd(); }
        finish(); return;
      }
      if (gesture.kind === 'shape' || gesture.kind === 'line') {
        const p = point(event);
        const v = boardViewport(event.currentTarget.clientWidth, event.currentTarget.clientHeight, current.current.scene.view);
        if (!('fromPort' in gesture && gesture.fromPort)
          && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) * v.scale < 6) updateDraft(gesture, p, true);
        else updateDraft(gesture, p);
      } else if (gesture.kind === 'transform') updateDraft(gesture, point(event));
      let connected = gesture.kind === 'line' && gesture.fromPort
        ? (draft.current as BoardLine | undefined)?.end.shapeId : undefined;
      if (gesture.kind === 'line' && gesture.fromPort && gesture.created && !connected) {
        const dropped = point(event), items = current.current.scene.items;
        if (!shapeAt(items, dropped)) {
          const node = { ...placedRectangle(crypto.randomUUID(), dropped, current.current.shapeColor, gesture.size),
            shape: current.current.tool === 'voice' ? current.current.voiceShape ?? 'rectangle' : 'rectangle' as const };
          const line = { ...(draft.current as BoardLine), end: { ...dropped, shapeId: node.id } };
          current.current.act({ kind: 'connect-node', line, node, reveal: true });
          gesture.lastSent = JSON.stringify(draft.current);
          connected = node.id;
        }
      }
      finish();
      if (gesture.kind === 'line' && connected && connected !== gesture.attachedStart.shapeId) {
        setSelected(connected); selectedRef.current = connected;
      }
      event.currentTarget.style.cursor = '';
    },
    onPointerCancel: (event: PointerEvent<HTMLCanvasElement>) => { viewport.pointerUp(event, false); finish(); },
    onLostPointerCapture: (event: PointerEvent<HTMLCanvasElement>) => { viewport.pointerUp(event, false); finish(); },
    onPointerLeave: (event: PointerEvent<HTMLCanvasElement>) => {
      event.currentTarget.style.cursor = ''; hover.current = undefined; paintRef.current();
    },
    onDoubleClick: (event: MouseEvent<HTMLCanvasElement>) => {
      const p = point(event), shape = shapeAt(current.current.scene.items, p);
      if (shape) { setSelected(shape.id); current.current.onText(p, shape); }
    },
  } };
}
