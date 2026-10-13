import { lineCurve, nodeHeight } from './geometry';
import { BOARD_WIDTH, BOARD_HEIGHT, BOARD_WORLD_LIMIT, type BoardElement, type BoardView } from './types';

export const DEFAULT_BOARD_VIEW: BoardView = { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2, zoom: 1 };
export const MIN_BOARD_ZOOM = .1;
export const MAX_BOARD_ZOOM = 8;
export const boardCoordinate = (value: number) => Math.max(-BOARD_WORLD_LIMIT, Math.min(BOARD_WORLD_LIMIT, value));

export function boardViewport(width: number, height: number, view = DEFAULT_BOARD_VIEW) {
  const scale = Math.max(.0001, Math.min(width / BOARD_WIDTH, height / BOARD_HEIGHT) * view.zoom);
  return { scale, left: width / 2 - view.x * scale, top: height / 2 - view.y * scale };
}

export interface ElementBounds { left: number; top: number; right: number; bottom: number }
const boundsCache = new WeakMap<BoardElement, ElementBounds>();
export function boardElementBounds(item: BoardElement, items: BoardElement[]): ElementBounds {
  const cached = item.kind !== 'line' && boundsCache.get(item);
  if (cached) return cached;
  let result: ElementBounds;
  if (item.kind === 'shape' || item.kind === 'image') {
    result = { left: item.x, top: item.y, right: item.x + item.width, bottom: item.y + nodeHeight(item) };
  } else if (item.kind === 'text') {
    const lines = item.text.split('\n');
    result = { left: item.x, top: item.y, right: item.x + Math.max(1, ...lines.map(line => line.length)) * item.size,
      bottom: item.y + lines.length * item.size * 1.4 };
  } else {
    const curve = item.kind === 'line' ? lineCurve(item, items) : undefined;
    const points = curve ? [curve.start, curve.c1, curve.c2, curve.end] : item.kind === 'stroke' ? item.points : [];
    result = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const p of points) {
      result.left = Math.min(result.left, p.x); result.right = Math.max(result.right, p.x);
      result.top = Math.min(result.top, p.y); result.bottom = Math.max(result.bottom, p.y);
    }
  }
  if (item.kind !== 'line') boundsCache.set(item, result);
  return result;
}

export function fitBoardView(items: BoardElement[]): BoardView {
  if (!items.length) return { ...DEFAULT_BOARD_VIEW };
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const item of items) {
    const b = boardElementBounds(item, items);
    left = Math.min(left, b.left); top = Math.min(top, b.top);
    right = Math.max(right, b.right); bottom = Math.max(bottom, b.bottom);
  }
  return { x: boardCoordinate((left + right) / 2), y: boardCoordinate((top + bottom) / 2),
    zoom: Math.max(MIN_BOARD_ZOOM, Math.min(1, BOARD_WIDTH / (right - left + 120), BOARD_HEIGHT / (bottom - top + 120))) };
}
