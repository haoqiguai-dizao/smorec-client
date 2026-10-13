import { IMAGE_CAPTION_HEIGHT, type BoardElement, type BoardEndpoint, type BoardImage, type BoardLine, type BoardPoint,
  type BoardPort, type BoardShape } from './types';

export type BoardNode = BoardShape | BoardImage;
export const nodeHeight = (node: BoardNode) => node.height + (node.kind === 'image' ? IMAGE_CAPTION_HEIGHT : 0);
export function nodeContains(node: BoardNode, point: BoardPoint, margin = 0): boolean {
  if (node.kind === 'shape') return shapeContains(node, point, margin);
  return point.x >= node.x - margin && point.x <= node.x + node.width + margin
    && point.y >= node.y - margin && point.y <= node.y + nodeHeight(node) + margin;
}

export function distanceToSegment(point: BoardPoint, a: BoardPoint, b: BoardPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

export function shapeContains(shape: BoardShape, point: BoardPoint, margin = 0): boolean {
  const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2;
  const rx = shape.width / 2 + margin, ry = shape.height / 2 + margin;
  if (rx <= 0 || ry <= 0) return false;
  const x = Math.abs(point.x - cx) / rx, y = Math.abs(point.y - cy) / ry;
  if (shape.shape === 'ellipse') return x * x + y * y <= 1;
  if (shape.shape === 'diamond') return x + y <= 1;
  return x <= 1 && y <= 1;
}

export function shapeAt(items: BoardElement[], point: BoardPoint, margin = 0): BoardNode | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if ((item.kind === 'shape' || item.kind === 'image') && nodeContains(item, point, margin)) return item;
  }
}

function boundary(shape: BoardNode, toward: BoardPoint): BoardPoint {
  const cx = shape.x + shape.width / 2, cy = shape.y + nodeHeight(shape) / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  const rx = shape.width / 2, ry = nodeHeight(shape) / 2;
  if (!dx && !dy) return { x: cx, y: cy };
  let scale: number;
  if (shape.kind === 'shape' && shape.shape === 'ellipse') scale = 1 / Math.hypot(dx / rx, dy / ry);
  else if (shape.kind === 'shape' && shape.shape === 'diamond') scale = 1 / (Math.abs(dx) / rx + Math.abs(dy) / ry);
  else scale = 1 / Math.max(Math.abs(dx) / rx, Math.abs(dy) / ry);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function portPoint(shape: BoardNode, port: BoardPort): BoardPoint {
  const x = shape.x + shape.width / 2, y = shape.y + nodeHeight(shape) / 2;
  if (port === 'top') return { x, y: shape.y };
  if (port === 'right') return { x: shape.x + shape.width, y };
  if (port === 'bottom') return { x, y: shape.y + nodeHeight(shape) };
  return { x: shape.x, y };
}

/** Attached endpoints are recomputed from the current shapes on every preview/export frame. */
export function linePoints(line: BoardLine, items: BoardElement[]): [BoardPoint, BoardPoint] {
  const shapes = new Map(items.filter((item): item is BoardNode => item.kind === 'shape' || item.kind === 'image').map(item => [item.id, item]));
  const startShape = line.start.shapeId ? shapes.get(line.start.shapeId) : undefined;
  const endShape = line.end.shapeId ? shapes.get(line.end.shapeId) : undefined;
  const center = (shape: BoardNode): BoardPoint => ({ x: shape.x + shape.width / 2, y: shape.y + nodeHeight(shape) / 2 });
  const a = startShape ? center(startShape) : line.start;
  const b = endShape ? center(endShape) : line.end;
  return [startShape ? line.start.port ? portPoint(startShape, line.start.port) : boundary(startShape, b) : a,
    endShape ? line.end.port ? portPoint(endShape, line.end.port) : boundary(endShape, a) : b];
}

function direction(port: BoardPort | undefined, from: BoardPoint, to: BoardPoint): BoardPoint {
  if (port === 'top') return { x: 0, y: -1 };
  if (port === 'bottom') return { x: 0, y: 1 };
  if (port === 'left') return { x: -1, y: 0 };
  if (port === 'right') return { x: 1, y: 0 };
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
    ? { x: Math.sign(to.x - from.x) || 1, y: 0 } : { x: 0, y: Math.sign(to.y - from.y) || 1 };
}

/** One cubic route is shared by painting, selection and eraser hit testing. */
export function lineCurve(line: BoardLine, items: BoardElement[]) {
  const [start, end] = linePoints(line, items);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const offset = Math.max(36, Math.min(160, length * .42));
  const a = direction(line.start.port, start, end), b = direction(line.end.port, end, start);
  return { start, end,
    c1: { x: start.x + a.x * offset, y: start.y + a.y * offset },
    c2: { x: end.x + b.x * offset, y: end.y + b.y * offset } };
}

export function curvePoint(curve: ReturnType<typeof lineCurve>, t: number): BoardPoint {
  const u = 1 - t;
  return { x: u ** 3 * curve.start.x + 3 * u ** 2 * t * curve.c1.x + 3 * u * t ** 2 * curve.c2.x + t ** 3 * curve.end.x,
    y: u ** 3 * curve.start.y + 3 * u ** 2 * t * curve.c1.y + 3 * u * t ** 2 * curve.c2.y + t ** 3 * curve.end.y };
}

export function distanceToCurve(point: BoardPoint, curve: ReturnType<typeof lineCurve>): number {
  let distance = Infinity, previous = curve.start;
  const length = Math.hypot(curve.end.x - curve.start.x, curve.end.y - curve.start.y);
  const steps = Math.max(16, Math.min(48, Math.ceil(length / 12)));
  for (let i = 1; i <= steps; i++) {
    const next = curvePoint(curve, i / steps);
    distance = Math.min(distance, distanceToSegment(point, previous, next)); previous = next;
  }
  return distance;
}

export function attached(point: BoardPoint, items: BoardElement[], margin = 0): BoardEndpoint {
  const shape = shapeAt(items, point, margin);
  return shape ? { ...point, shapeId: shape.id } : point;
}

export function elementAt(items: BoardElement[], point: BoardPoint, tolerance: number): BoardElement | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if ((item.kind === 'shape' || item.kind === 'image') && nodeContains(item, point, tolerance)) return item;
    if (item.kind === 'line') {
      if (distanceToCurve(point, lineCurve(item, items)) <= tolerance + item.size / 2) return item;
    }
    if (item.kind === 'text') {
      const lines = item.text.split('\n');
      if (point.x >= item.x - tolerance && point.x <= item.x + Math.max(...lines.map(line => line.length), 1) * item.size * .6 + tolerance
        && point.y >= item.y - tolerance && point.y <= item.y + lines.length * item.size * 1.4 + tolerance) return item;
    }
    if (item.kind === 'stroke' && item.color !== '#ffffff') {
      if (item.points.length === 1 && Math.hypot(item.points[0].x - point.x, item.points[0].y - point.y) <= tolerance + item.size / 2) return item;
      for (let j = 1; j < item.points.length; j++) {
        if (distanceToSegment(point, item.points[j - 1], item.points[j]) <= tolerance + item.size / 2) return item;
      }
    }
  }
}
