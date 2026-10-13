import { attached, nodeHeight } from '../../shared/whiteboard/geometry';
import { BOARD_WORLD_LIMIT, IMAGE_CAPTION_HEIGHT, type BoardElement, type BoardEndpoint, type BoardLine,
  type BoardImage, type BoardPoint, type BoardShape, type BoardShapeKind } from '../../shared/whiteboard/types';
import type { BoardHandle } from '../services/whiteboard-selection';

const clamp = (value: number, limit: number) => Math.max(-BOARD_WORLD_LIMIT, Math.min(limit, value));

export function drawnShape(id: string, shape: BoardShapeKind, start: BoardPoint, end: BoardPoint,
  color: string, size: number, click = false): BoardShape {
  const to = click ? { x: Math.min(BOARD_WORLD_LIMIT, start.x + (shape === 'ellipse' ? 140 : 200)),
    y: Math.min(BOARD_WORLD_LIMIT, start.y + (shape === 'ellipse' ? 140 : 110)) } : end;
  let x = Math.min(start.x, to.x), y = Math.min(start.y, to.y);
  const width = Math.max(24, Math.abs(to.x - start.x)), height = Math.max(24, Math.abs(to.y - start.y));
  if (x + width > BOARD_WORLD_LIMIT) x = BOARD_WORLD_LIMIT - width;
  if (y + height > BOARD_WORLD_LIMIT) y = BOARD_WORLD_LIMIT - height;
  return { kind: 'shape', id, shape, color, size, x, y, width, height, text: '' };
}

export function placedRectangle(id: string, center: BoardPoint, color: string, size: number): BoardShape {
  const width = 200, height = 110;
  return { kind: 'shape', id, shape: 'rectangle', color, size,
    x: clamp(center.x - width / 2, BOARD_WORLD_LIMIT - width),
    y: clamp(center.y - height / 2, BOARD_WORLD_LIMIT - height), width, height, text: '' };
}

export function drawnLine(id: string, start: BoardEndpoint, end: BoardPoint,
  items: BoardElement[], arrow: boolean, color: string, size: number, click = false, snapMargin = 0): BoardLine {
  const target = click ? { x: clamp(start.x + 170, BOARD_WORLD_LIMIT), y: start.y } : end;
  const snapped = attached(target, items, snapMargin);
  return { kind: 'line', id, start, end: snapped.shapeId === start.shapeId ? target : snapped, arrow, color, size };
}

export function movedElement(item: BoardElement, dx: number, dy: number): BoardElement {
  if (item.kind === 'shape' || item.kind === 'image') {
    return { ...item, x: clamp(item.x + dx, BOARD_WORLD_LIMIT - item.width),
      y: clamp(item.y + dy, BOARD_WORLD_LIMIT - nodeHeight(item)) };
  }
  if (item.kind === 'text') return { ...item, x: clamp(item.x + dx, BOARD_WORLD_LIMIT), y: clamp(item.y + dy, BOARD_WORLD_LIMIT) };
  if (item.kind === 'stroke') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of item.points) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    const boundedX = Math.max(-BOARD_WORLD_LIMIT - minX, Math.min(BOARD_WORLD_LIMIT - maxX, dx));
    const boundedY = Math.max(-BOARD_WORLD_LIMIT - minY, Math.min(BOARD_WORLD_LIMIT - maxY, dy));
    return { ...item, points: item.points.map(p => ({ x: p.x + boundedX, y: p.y + boundedY })) };
  }
  // A line attached to shapes moves only through its endpoint handles.
  if (item.start.shapeId || item.end.shapeId) return item;
  const dxBounded = Math.max(-BOARD_WORLD_LIMIT - Math.min(item.start.x, item.end.x), Math.min(BOARD_WORLD_LIMIT - Math.max(item.start.x, item.end.x), dx));
  const dyBounded = Math.max(-BOARD_WORLD_LIMIT - Math.min(item.start.y, item.end.y), Math.min(BOARD_WORLD_LIMIT - Math.max(item.start.y, item.end.y), dy));
  return { ...item, start: { x: item.start.x + dxBounded, y: item.start.y + dyBounded },
    end: { x: item.end.x + dxBounded, y: item.end.y + dyBounded } };
}

export function resizedImage(item: BoardImage, handle: BoardHandle, point: BoardPoint): BoardImage {
  const right = item.x + item.width, bottom = item.y + item.height + IMAGE_CAPTION_HEIGHT;
  const leftSide = handle.includes('w'), topSide = handle.includes('n');
  const anchorX = leftSide ? right : item.x, anchorY = topSide ? bottom : item.y;
  const horizontal = Math.abs(point.x - anchorX);
  const vertical = Math.max(0, Math.abs(point.y - anchorY) - IMAGE_CAPTION_HEIGHT);
  const desired = (horizontal * item.width + vertical * item.height) * item.width
    / (item.width ** 2 + item.height ** 2);
  const width = Math.max(96, Math.min(600, desired));
  const height = Math.max(48, width * item.height / item.width);
  const boundedWidth = Math.min(width, leftSide ? anchorX + BOARD_WORLD_LIMIT : BOARD_WORLD_LIMIT - anchorX);
  const boundedHeight = Math.min(height, topSide ? anchorY + BOARD_WORLD_LIMIT - IMAGE_CAPTION_HEIGHT : BOARD_WORLD_LIMIT - anchorY - IMAGE_CAPTION_HEIGHT);
  const finalWidth = Math.max(96, Math.min(boundedWidth, boundedHeight * item.width / item.height));
  const finalHeight = finalWidth * item.height / item.width;
  return { ...item, x: leftSide ? anchorX - finalWidth : anchorX,
    y: topSide ? anchorY - finalHeight - IMAGE_CAPTION_HEIGHT : anchorY, width: finalWidth, height: finalHeight };
}

export function resizedShape(item: BoardShape, handle: BoardHandle, point: BoardPoint): BoardShape {
  let left = item.x, right = item.x + item.width, top = item.y, bottom = item.y + item.height;
  if (handle.includes('w')) left = Math.min(point.x, right - 24);
  if (handle.includes('e')) right = Math.max(point.x, left + 24);
  if (handle.includes('n')) top = Math.min(point.y, bottom - 24);
  if (handle.includes('s')) bottom = Math.max(point.y, top + 24);
  left = clamp(left, BOARD_WORLD_LIMIT - 24); right = clamp(right, BOARD_WORLD_LIMIT);
  top = clamp(top, BOARD_WORLD_LIMIT - 24); bottom = clamp(bottom, BOARD_WORLD_LIMIT);
  return { ...item, x: left, y: top, width: right - left, height: bottom - top };
}
