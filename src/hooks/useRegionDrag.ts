import { useRef, useState, type PointerEvent } from 'react';
import type { Rect } from '../../shared/types';
import { selectionRect } from '../../shared/region-selection';

export function useRegionDrag(initial?: Rect) {
  const [rect, setRect] = useState<Rect | undefined>(initial);
  const drag = useRef<{ start: { x: number; y: number }; before?: Rect; handle: string; id: number } | undefined>(undefined);
  const point = (event: PointerEvent) => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) });
  const down = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const handle = (event.target as HTMLElement).dataset.handle ?? '';
    drag.current = { start: point(event), before: rect, handle, id: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!handle) setRect({ ...point(event), width: 0, height: 0 });
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const next = point(event), previous = current.before;
    if (!current.handle || !previous) { setRect(selectionRect(current.start, next)); return; }
    if (current.handle === 'move') {
      setRect({ ...previous, x: Math.max(0, Math.min(innerWidth - previous.width, previous.x + next.x - current.start.x)),
        y: Math.max(0, Math.min(innerHeight - previous.height, previous.y + next.y - current.start.y)) }); return;
    }
    const dx = next.x - current.start.x, dy = next.y - current.start.y;
    const a = { x: current.handle.includes('w') ? previous.x + dx : previous.x, y: current.handle.includes('n') ? previous.y + dy : previous.y };
    const b = { x: current.handle.includes('e') ? previous.x + previous.width + dx : previous.x + previous.width,
      y: current.handle.includes('s') ? previous.y + previous.height + dy : previous.y + previous.height };
    setRect(selectionRect({ x: Math.max(0, Math.min(innerWidth, a.x)), y: Math.max(0, Math.min(innerHeight, a.y)) },
      { x: Math.max(0, Math.min(innerWidth, b.x)), y: Math.max(0, Math.min(innerHeight, b.y)) }));
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { rect, setRect, events: { onPointerDown: down, onPointerMove: move, onPointerUp: end,
    onPointerCancel: (event: PointerEvent<HTMLElement>) => { setRect(drag.current?.before); end(event); } } };
}
