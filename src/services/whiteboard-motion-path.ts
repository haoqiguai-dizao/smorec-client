import { curvePoint, type lineCurve } from '../../shared/whiteboard/geometry';
import type { BoardPoint, BoardShape } from '../../shared/whiteboard/types';

function sampledLength(point: (t: number) => BoardPoint, steps = 64): number {
  let length = 0, previous = point(0);
  for (let i = 1; i <= steps; i++) {
    const next = point(i / steps);
    length += Math.hypot(next.x - previous.x, next.y - previous.y); previous = next;
  }
  return length;
}
export function curveLength(curve: ReturnType<typeof lineCurve>): number {
  return sampledLength(t => curvePoint(curve, t));
}
export function shapeOutlineLength(item: BoardShape): number {
  const { width, height } = item;
  if (item.shape === 'rectangle') {
    const radius = Math.min(20, width * .12, height * .2);
    return 2 * (width + height) - 8 * radius + 2 * Math.PI * radius;
  }
  if (item.shape === 'ellipse') return sampledLength(t => ({
    x: width / 2 * Math.cos(t * 2 * Math.PI), y: height / 2 * Math.sin(t * 2 * Math.PI)
  }), 128);
  const corners = [{ x: width / 2, y: 0 }, { x: width, y: height / 2 },
    { x: width / 2, y: height }, { x: 0, y: height / 2 }];
  const ratio = Math.min(.08, 7 / Math.min(width, height));
  let length = 0;
  corners.forEach((corner, i) => {
    const before = corners[(i + 3) % 4], after = corners[(i + 1) % 4];
    const start = { x: corner.x + (before.x - corner.x) * ratio, y: corner.y + (before.y - corner.y) * ratio };
    const end = { x: corner.x + (after.x - corner.x) * ratio, y: corner.y + (after.y - corner.y) * ratio };
    length += sampledLength(t => ({ x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * corner.x + t ** 2 * end.x,
      y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * corner.y + t ** 2 * end.y }), 16);
    length += Math.hypot(after.x - corner.x, after.y - corner.y) * (1 - 2 * ratio);
  });
  return length;
}

/** Clear dashes at the final frame, so every finished shape uses its original path. */
export function setRevealDash(ctx: CanvasRenderingContext2D, length: number, amount: number): void {
  ctx.setLineDash(amount >= 1 ? [] : [length, length]);
  ctx.lineDashOffset = amount >= 1 ? 0 : length * (1 - amount);
}
