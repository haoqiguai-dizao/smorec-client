import type { BoardShape } from '../../shared/whiteboard/types';

export const diagramStroke = (size: number) => Math.max(1.5, size * .65);

export function shapePath(ctx: CanvasRenderingContext2D, item: BoardShape): void {
  ctx.beginPath();
  if (item.shape === 'text') ctx.rect(item.x, item.y, item.width, item.height);
  else if (item.shape === 'rectangle') ctx.roundRect(item.x, item.y, item.width, item.height,
    Math.min(20, item.width * .12, item.height * .2));
  else if (item.shape === 'ellipse') ctx.ellipse(item.x + item.width / 2, item.y + item.height / 2,
    item.width / 2, item.height / 2, 0, 0, Math.PI * 2);
  else {
    const corners = [{ x: item.x + item.width / 2, y: item.y },
      { x: item.x + item.width, y: item.y + item.height / 2 },
      { x: item.x + item.width / 2, y: item.y + item.height },
      { x: item.x, y: item.y + item.height / 2 }];
    const ratio = Math.min(.08, 7 / Math.min(item.width, item.height));
    corners.forEach((point, i) => {
      const before = corners[(i + 3) % 4], after = corners[(i + 1) % 4];
      const x = point.x + (before.x - point.x) * ratio, y = point.y + (before.y - point.y) * ratio;
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      ctx.quadraticCurveTo(point.x, point.y, point.x + (after.x - point.x) * ratio, point.y + (after.y - point.y) * ratio);
    });
    ctx.closePath();
  }
}

export function paintDiagramStroke(ctx: CanvasRenderingContext2D, color: string, size: number, transparent: boolean): void {
  if (transparent) {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = size + 2.5; ctx.stroke();
  }
  ctx.strokeStyle = color; ctx.lineWidth = size; ctx.stroke();
}
