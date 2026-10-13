import { lineCurve, linePoints, portPoint, nodeHeight } from '../../shared/whiteboard/geometry';
import { BOARD_WORLD_LIMIT, type BoardElement, type BoardPoint,
  type BoardPort, type BoardShape } from '../../shared/whiteboard/types';

export type BoardHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  | 'start' | 'end' | `connect-${BoardPort}`;

export function connectionPort(handle?: BoardHandle): BoardPort | undefined {
  return handle?.startsWith('connect-') ? handle.slice(8) as BoardPort : undefined;
}

export function handleCursor(handle?: BoardHandle): string | undefined {
  if (connectionPort(handle)) return 'crosshair';
  if (handle === 'start' || handle === 'end') return 'move';
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  if (handle === 'nw' || handle === 'se') return 'nwse-resize';
  return handle ? 'grab' : undefined;
}

function connectorHandle(item: BoardShape, port: BoardPort, scale: number): BoardPoint {
  const point = portPoint(item, port), gap = 24 / scale, detour = 40 / scale, inset = 8 / scale;
  const position = { ...point };
  if (port === 'top') position.y = Math.max(-BOARD_WORLD_LIMIT + inset, point.y - gap);
  if (port === 'right') position.x = Math.min(BOARD_WORLD_LIMIT - inset, point.x + gap);
  if (port === 'bottom') position.y = Math.min(BOARD_WORLD_LIMIT - inset, point.y + gap);
  if (port === 'left') position.x = Math.max(-BOARD_WORLD_LIMIT + inset, point.x - gap);
  if (Math.hypot(position.x - point.x, position.y - point.y) < 18 / scale) {
    if (port === 'top' || port === 'bottom') {
      position.x = Math.max(-BOARD_WORLD_LIMIT + inset, Math.min(BOARD_WORLD_LIMIT - inset,
        point.x + (point.x + detour <= BOARD_WORLD_LIMIT - inset ? detour : -detour)));
    } else {
      position.y = Math.max(-BOARD_WORLD_LIMIT + inset, Math.min(BOARD_WORLD_LIMIT - inset,
        point.y + (point.y + detour <= BOARD_WORLD_LIMIT - inset ? detour : -detour)));
    }
  }
  return position;
}

export function selectionHandles(item: BoardElement, all: BoardElement[], scale = 1): Partial<Record<BoardHandle, BoardPoint>> {
  if (item.kind === 'shape') return {
    nw: { x: item.x, y: item.y }, ne: { x: item.x + item.width, y: item.y },
    sw: { x: item.x, y: item.y + nodeHeight(item) }, se: { x: item.x + item.width, y: item.y + nodeHeight(item) },
    'connect-top': connectorHandle(item, 'top', scale),
    'connect-right': connectorHandle(item, 'right', scale),
    'connect-bottom': connectorHandle(item, 'bottom', scale),
    'connect-left': connectorHandle(item, 'left', scale),
  };
  if (item.kind === 'image') return {
    nw: { x: item.x, y: item.y }, ne: { x: item.x + item.width, y: item.y },
    sw: { x: item.x, y: item.y + nodeHeight(item) }, se: { x: item.x + item.width, y: item.y + nodeHeight(item) },
    'connect-top': portPoint(item, 'top'), 'connect-right': portPoint(item, 'right'),
    'connect-bottom': portPoint(item, 'bottom'), 'connect-left': portPoint(item, 'left'),
  };
  if (item.kind === 'line') {
    const [start, end] = linePoints(item, all);
    return { start, end };
  }
  return {};
}

export function handleAt(item: BoardElement, all: BoardElement[], point: BoardPoint,
  tolerance: number, scale = 1): BoardHandle | undefined {
  let nearest: BoardHandle | undefined, distance = tolerance;
  for (const [name, p] of Object.entries(selectionHandles(item, all, scale))) {
    const next = p && Math.hypot(p.x - point.x, p.y - point.y);
    if (next !== undefined && next <= distance) { nearest = name as BoardHandle; distance = next; }
  }
  return nearest;
}

/** The full selected shape outline is draggable for one-axis resizing. */
export function edgeAt(item: BoardElement, point: BoardPoint, tolerance: number): BoardHandle | undefined {
  if (item.kind !== 'shape') return undefined;
  const right = item.x + item.width, bottom = item.y + item.height;
  if (point.x < item.x - tolerance || point.x > right + tolerance
    || point.y < item.y - tolerance || point.y > bottom + tolerance) return undefined;
  const edges: Array<[BoardHandle, number]> = [
    ['n', Math.abs(point.y - item.y)], ['e', Math.abs(point.x - right)],
    ['s', Math.abs(point.y - bottom)], ['w', Math.abs(point.x - item.x)],
  ];
  const nearest = edges.reduce((best, next) => next[1] < best[1] ? next : best);
  return nearest[1] <= tolerance ? nearest[0] : undefined;
}

export function paintSelection(ctx: CanvasRenderingContext2D, item: BoardElement, all: BoardElement[], scale: number): void {
  ctx.save();
  ctx.strokeStyle = '#3074e8'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([5 / scale, 4 / scale]);
  if (item.kind === 'shape' || item.kind === 'image') {
    ctx.strokeRect(item.x - 5 / scale, item.y - 5 / scale, item.width + 10 / scale, nodeHeight(item) + 10 / scale);
  } else if (item.kind === 'line') {
    const { start, end, c1, c2 } = lineCurve(item, all);
    ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const [name, point] of Object.entries(selectionHandles(item, all, scale))) {
    if (!point) continue;
    const connector = !!connectionPort(name as BoardHandle);
    if (connector && item.kind === 'shape') {
      const anchor = portPoint(item, connectionPort(name as BoardHandle)!);
      ctx.strokeStyle = '#3074e8'; ctx.lineWidth = 1.5 / scale;
      ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(point.x, point.y); ctx.stroke();
    }
    ctx.fillStyle = connector ? '#3074e8' : '#ffffff';
    ctx.strokeStyle = connector ? '#ffffff' : '#3074e8';
    ctx.beginPath(); ctx.arc(point.x, point.y, (connector ? 6 : 5) / scale, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
