import { useEffect, useRef, type RefObject, type PointerEvent } from 'react';
import type { BoardAction, BoardElement, BoardView } from '../../shared/whiteboard/types';
import { boardCoordinate, boardViewport, DEFAULT_BOARD_VIEW, fitBoardView,
  MAX_BOARD_ZOOM, MIN_BOARD_ZOOM } from '../../shared/whiteboard/viewport';

interface Options {
  session?: string;
  canvas: RefObject<HTMLCanvasElement | null>; enabled: boolean; hand: boolean;
  view?: BoardView; items: BoardElement[]; act: (action: BoardAction) => void;
  finish: () => void; drawing: () => boolean;
}

/** Camera movement changes coordinates, never the canvas bitmap size or element positions. */
export function useWhiteboardViewport(options: Options) {
  const current = useRef(options); current.current = options;
  const space = useRef(false);
  const pan = useRef<{ id: number; x: number; y: number; view: BoardView; scale: number } | undefined>(undefined);
  const pending = useRef<BoardView | undefined>(undefined);
  const scheduled = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (scheduled.current !== undefined) cancelAnimationFrame(scheduled.current);
    scheduled.current = undefined; pending.current = undefined; pan.current = undefined; space.current = false;
  }, [options.session]);
  const view = () => pending.current ?? current.current.view ?? DEFAULT_BOARD_VIEW;
  const flush = () => {
    if (scheduled.current !== undefined) cancelAnimationFrame(scheduled.current);
    scheduled.current = undefined;
    if (pending.current) { current.current.act({ kind: 'viewport', view: pending.current }); pending.current = undefined; }
  };
  const move = (next: BoardView) => {
    pending.current = { x: boardCoordinate(next.x), y: boardCoordinate(next.y),
      zoom: Math.max(MIN_BOARD_ZOOM, Math.min(MAX_BOARD_ZOOM, next.zoom)) };
    scheduled.current ??= requestAnimationFrame(flush);
  };
  const zoom = (factor: number, anchor?: { x: number; y: number }) => {
    const target = current.current.canvas.current;
    if (!target || !current.current.enabled || current.current.drawing()) return;
    const before = view(), next = Math.max(MIN_BOARD_ZOOM, Math.min(MAX_BOARD_ZOOM, before.zoom * factor));
    const scale = boardViewport(target.clientWidth, target.clientHeight, before).scale;
    const dx = (anchor?.x ?? target.clientWidth / 2) - target.clientWidth / 2;
    const dy = (anchor?.y ?? target.clientHeight / 2) - target.clientHeight / 2;
    move({ x: before.x + dx / scale * (1 - before.zoom / next),
      y: before.y + dy / scale * (1 - before.zoom / next), zoom: next });
  };
  useEffect(() => {
    if (options.enabled && !options.view) options.act({ kind: 'viewport', view: { ...DEFAULT_BOARD_VIEW } });
  }, [options.enabled, options.view, options.act]);
  useEffect(() => {
    const target = options.canvas.current;
    if (!target) return;
    const editable = (target: EventTarget | null) => target instanceof HTMLElement
      && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || editable(event.target) || !current.current.enabled) return;
      event.preventDefault(); space.current = true; target.style.cursor = 'grab';
    };
    const release = () => { space.current = false; pan.current = undefined; target.style.cursor = ''; flush(); };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') release(); };
    const wheel = (event: WheelEvent) => {
      if (!current.current.enabled) return;
      event.preventDefault();
      if (current.current.drawing() || pan.current) return;
      const bounds = target.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1;
      if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * unit * .01),
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      else {
        const before = view(), scale = boardViewport(bounds.width, bounds.height, before).scale;
        move({ ...before, x: before.x + (event.shiftKey ? event.deltaY : event.deltaX) * unit / scale,
          y: before.y + (event.shiftKey ? 0 : event.deltaY) * unit / scale });
      }
    };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release);
    target.addEventListener('wheel', wheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release);
      target.removeEventListener('wheel', wheel);
      if (scheduled.current !== undefined) cancelAnimationFrame(scheduled.current);
    };
  }, [options.canvas]);
  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!current.current.enabled || !(event.button === 1 || event.button === 0 && (space.current || current.current.hand))) return false;
    event.preventDefault(); current.current.finish();
    const before = view();
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, view: before,
      scale: boardViewport(event.currentTarget.clientWidth, event.currentTarget.clientHeight, before).scale };
    event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.style.cursor = 'grabbing';
    return true;
  };
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const start = pan.current;
    if (!start) {
      if (space.current || current.current.hand) { event.currentTarget.style.cursor = 'grab'; return true; }
      return false;
    }
    if (event.pointerId !== start.id) return true;
    move({ ...start.view, x: start.view.x - (event.clientX - start.x) / start.scale,
      y: start.view.y - (event.clientY - start.y) / start.scale });
    return true;
  };
  const pointerUp = (event: PointerEvent<HTMLCanvasElement>, update = true) => {
    if (pan.current?.id !== event.pointerId) return false;
    if (update) pointerMove(event);
    pan.current = undefined; flush(); event.currentTarget.style.cursor = '';
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    return true;
  };
  return { pointerDown, pointerMove, pointerUp, zoom, finish: () => { pan.current = undefined; flush(); },
    fit: () => { if (current.current.enabled) { current.current.finish(); move(fitBoardView(current.current.items)); } },
    reset: () => { if (current.current.enabled) { current.current.finish(); move({ ...view(), zoom: 1 }); } } };
}
