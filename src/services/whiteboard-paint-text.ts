import { boardGraphemes } from '../../shared/whiteboard/motion';

interface TextStyle {
  color: string; size: number; transparent?: boolean; maxWidth?: number; weight?: 500 | 600;
  visibleCharacters?: number;
  caret?: boolean;
}

/** Contrast belongs to the live transparent view, never to persisted node colors. */
export function paintBoardText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: TextStyle): void {
  if (style.visibleCharacters === 0) return;
  ctx.save();
  ctx.font = `${style.weight ?? 500} ${style.size}px system-ui, sans-serif`;
  const characters = style.visibleCharacters === undefined ? undefined : boardGraphemes(text);
  if (characters && style.visibleCharacters! < characters.length) {
    const fullWidth = ctx.measureText(text).width;
    const scale = fullWidth ? Math.min(1, (style.maxWidth ?? fullWidth) / fullWidth) : 1;
    const aligned = ctx.textAlign === 'center' ? .5 : ctx.textAlign === 'right' || ctx.textAlign === 'end' ? 1 : 0;
    x = (x - fullWidth * scale * aligned) / scale;
    ctx.scale(scale, 1); ctx.textAlign = 'left';
    text = characters.slice(0, style.visibleCharacters).join('');
  }
  const maxWidth = characters && style.visibleCharacters! < characters.length ? undefined : style.maxWidth;
  if (style.transparent) {
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2.5, style.size * .12);
    ctx.strokeStyle = '#172033';
    ctx.strokeText(text, x, y, maxWidth);
  }
  ctx.fillStyle = style.transparent ? '#ffffff' : style.color;
  ctx.fillText(text, x, y, maxWidth);
  if (style.caret) {
    const width = Math.min(ctx.measureText(text).width, maxWidth ?? Infinity);
    const aligned = ctx.textAlign === 'center' ? .5 : ctx.textAlign === 'right' || ctx.textAlign === 'end' ? 1 : 0;
    const right = x + width * (1 - aligned) + 2;
    ctx.beginPath(); ctx.moveTo(right, y - style.size * .45); ctx.lineTo(right, y + style.size * .45);
    if (style.transparent) { ctx.strokeStyle = '#172033'; ctx.lineWidth = 3; ctx.stroke(); }
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.restore();
}
