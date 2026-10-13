import { lineCurve } from '../../shared/whiteboard/geometry';
import { IMAGE_CAPTION_HEIGHT, type BoardElement, type BoardImage, type BoardLine, type BoardShape } from '../../shared/whiteboard/types';
import { shapeLabel } from './whiteboard-text';
import { boardImage } from './whiteboard-images';
import { paintBoardText } from './whiteboard-paint-text';
import { diagramStroke, paintDiagramStroke, shapePath } from './whiteboard-diagram-style';
import { boardGraphemes, type BoardReveal } from '../../shared/whiteboard/motion';
import { curveLength, setRevealDash, shapeOutlineLength } from './whiteboard-motion-path';

export function paintShape(ctx: CanvasRenderingContext2D, item: BoardShape, transparent = false, reveal?: BoardReveal): void {
  if (reveal?.outline === 0) return;
  ctx.save();
  shapePath(ctx, item);
  if (item.shape !== 'text') {
    if (reveal && reveal.outline < 1) {
      setRevealDash(ctx, shapeOutlineLength(item), reveal.outline);
      paintDiagramStroke(ctx, item.color, diagramStroke(item.size), transparent);
      ctx.restore(); return;
    }
    if (!transparent) {
      ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#17203312'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    }
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * .045; ctx.fillStyle = item.color; ctx.fill(); ctx.globalAlpha = alpha;
    paintDiagramStroke(ctx, item.color, diagramStroke(item.size), transparent);
  }
  if (item.text) {
    ctx.save(); shapePath(ctx, item); ctx.clip();
    const inset = item.shape === 'diamond' ? .68 : item.shape === 'ellipse' ? .84 : 1;
    const { lines, size: fontSize } = shapeLabel(item.text, item.width * inset, item.height * inset);
    const lineHeight = fontSize * 1.3, middle = item.y + item.height / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let remaining = reveal ? Math.floor(lines.reduce((total, line) => total + boardGraphemes(line).length, 0) * reveal.text) : Infinity;
    lines.forEach((line, index) => {
      const count = boardGraphemes(line).length;
      paintBoardText(ctx, line, item.x + item.width / 2, middle + (index - (lines.length - 1) / 2) * lineHeight,
        { color: item.color, size: fontSize, transparent, weight: 600, maxWidth: Math.max(1, item.width * inset - 18),
          visibleCharacters: reveal ? Math.max(0, Math.min(count, remaining)) : undefined,
          caret: !!reveal?.caret && remaining > 0 && remaining <= count });
      remaining -= count;
    });
    ctx.restore();
  }
  ctx.restore();
}

export function paintImage(ctx: CanvasRenderingContext2D, item: BoardImage, scope?: string, transparent = false): void {
  ctx.save();
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#cdd2d9'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(item.x, item.y, item.width, item.height + IMAGE_CAPTION_HEIGHT, 12); ctx.fill(); ctx.stroke();
  ctx.save();
  ctx.beginPath(); ctx.roundRect(item.x + 2, item.y + 2, item.width - 4, item.height - 2, [10, 10, 0, 0]); ctx.clip();
  ctx.fillStyle = '#f1f2f4'; ctx.fillRect(item.x, item.y, item.width, item.height);
  const image = scope && boardImage(scope, item.asset);
  if (image) {
    const scale = Math.min(item.width / image.naturalWidth, item.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    ctx.drawImage(image, item.x + (item.width - width) / 2, item.y + (item.height - height) / 2, width, height);
  }
  ctx.restore();
  ctx.strokeStyle = '#e5e7eb'; ctx.beginPath(); ctx.moveTo(item.x, item.y + item.height);
  ctx.lineTo(item.x + item.width, item.y + item.height); ctx.stroke();
  if (item.caption) {
    const { lines, size } = shapeLabel(item.caption, item.width - 20, IMAGE_CAPTION_HEIGHT - 8);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    lines.slice(0, 2).forEach((line, index) => paintBoardText(ctx, line, item.x + 10,
      item.y + item.height + IMAGE_CAPTION_HEIGHT / 2 + (index - (Math.min(lines.length, 2) - 1) / 2) * 20,
      { color: item.color, size: Math.min(size, 18), transparent, maxWidth: item.width - 20 }));
  }
  ctx.restore();
}

export function paintLine(ctx: CanvasRenderingContext2D, item: BoardLine, all: BoardElement[], transparent = false, reveal?: BoardReveal): void {
  if (reveal?.outline === 0) return;
  const curve = lineCurve(item, all), { start, end, c1, c2 } = curve;
  ctx.save();
  const stroke = diagramStroke(item.size);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
  if (reveal) setRevealDash(ctx, curveLength(curve), reveal.outline);
  paintDiagramStroke(ctx, item.color, stroke, transparent);
  if (item.arrow && (!reveal || reveal.arrow > 0) && Math.hypot(end.x - start.x, end.y - start.y) > 8) {
    const angle = Math.atan2(end.y - c2.y, end.x - c2.x), length = Math.max(9, stroke * 3.5);
    ctx.beginPath();
    ctx.moveTo(end.x - Math.cos(angle - Math.PI / 6) * length, end.y - Math.sin(angle - Math.PI / 6) * length);
    ctx.lineTo(end.x, end.y);
    ctx.lineTo(end.x - Math.cos(angle + Math.PI / 6) * length, end.y - Math.sin(angle + Math.PI / 6) * length);
    if (reveal) setRevealDash(ctx, length * 2, reveal.arrow);
    paintDiagramStroke(ctx, item.color, stroke, transparent);
  }
  ctx.restore();
}
