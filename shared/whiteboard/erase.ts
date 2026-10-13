import { distanceToCurve, lineCurve, nodeContains } from './geometry';
import type { BoardElement, BoardPoint, BoardStroke } from './types';

function keptIntervals(a: BoardPoint, b: BoardPoint, center: BoardPoint, radius: number): [number, number][] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(a.x - center.x, a.y - center.y) > radius ? [[0, 1]] : [];
  const fx = a.x - center.x, fy = a.y - center.y;
  const discriminant = (fx * dx + fy * dy) ** 2 - length2 * (fx * fx + fy * fy - radius * radius);
  if (discriminant <= 0) return [[0, 1]];
  const root = Math.sqrt(discriminant), projection = -(fx * dx + fy * dy);
  const entry = (projection - root) / length2, exit = (projection + root) / length2;
  if (exit <= 0 || entry >= 1) return [[0, 1]];
  const intervals: [number, number][] = [];
  if (entry > 0) intervals.push([0, Math.min(entry, 1)]);
  if (exit < 1) intervals.push([Math.max(exit, 0), 1]);
  return intervals;
}

function splitStroke(stroke: BoardStroke, point: BoardPoint, radius: number, prefix: string): BoardStroke[] {
  const limit = radius + stroke.size / 2;
  if (stroke.points.length === 1) return Math.hypot(stroke.points[0].x - point.x, stroke.points[0].y - point.y) <= limit ? [] : [stroke];
  const fragments: BoardStroke[] = [];
  let current: BoardPoint[] = [];
  const finish = () => {
    if (current.length) fragments.push({ ...stroke, id: `${prefix}:${fragments.length}`, points: current });
    current = [];
  };
  const along = (a: BoardPoint, b: BoardPoint, t: number): BoardPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1], b = stroke.points[i];
    const intervals = keptIntervals(a, b, point, limit);
    if (!intervals.length) { finish(); continue; }
    for (const [start, end] of intervals) {
      const first = along(a, b, start), last = along(a, b, end);
      if (current.length && Math.hypot(current.at(-1)!.x - first.x, current.at(-1)!.y - first.y) > 0.001) finish();
      if (!current.length) current.push(first);
      if (Math.hypot(last.x - first.x, last.y - first.y) > 0.001) current.push(last);
      if (end < 1) finish();
    }
  }
  finish();
  return fragments.length === 1 && fragments[0].points.length === stroke.points.length
    && fragments[0].points.every((part, i) => Math.hypot(part.x - stroke.points[i].x, part.y - stroke.points[i].y) < .001)
    ? [stroke] : fragments;
}

function touches(item: BoardElement, point: BoardPoint, radius: number, all: BoardElement[]): boolean {
  if (item.kind === 'shape' || item.kind === 'image') return nodeContains(item, point, radius);
  if (item.kind === 'line') {
    return distanceToCurve(point, lineCurve(item, all)) <= radius + item.size / 2;
  }
  if (item.kind === 'text') {
    const lines = item.text.split('\n'), width = Math.max(...lines.map(line => line.length), 1) * item.size * .6;
    return point.x >= item.x - radius && point.x <= item.x + width + radius
      && point.y >= item.y - radius && point.y <= item.y + lines.length * item.size * 1.4 + radius;
  }
  return false;
}

/** Erase ink geometrically; shapes, connectors and labels remain editable objects. */
export function eraseBoard(items: BoardElement[], points: BoardPoint[], radius: number, eventId: string): BoardElement[] {
  let next = items;
  points.forEach((point, pointIndex) => {
    const removed = new Set(next.filter(item => item.kind !== 'stroke' && touches(item, point, radius, next)).map(item => item.id));
    if (removed.size) for (const item of next) {
      if (item.kind === 'line' && (item.start.shapeId && removed.has(item.start.shapeId)
        || item.end.shapeId && removed.has(item.end.shapeId))) removed.add(item.id);
    }
    next = next.flatMap((item, itemIndex) => {
      if (removed.has(item.id)) return [];
      if (item.kind !== 'stroke' || item.color === '#ffffff') return [item];
      return splitStroke(item, point, radius, `${eventId}:${pointIndex}:${itemIndex}`);
    });
  });
  return next;
}
