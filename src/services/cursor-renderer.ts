import type { CursorSample } from '../../shared/types';

export function drawCursor(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, shape: CursorSample['shape']) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.shadowColor = '#00000065'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#1a1b20'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (shape === 'ibeam') {
    ctx.moveTo(-5, -11); ctx.lineTo(5, -11); ctx.moveTo(0, -11); ctx.lineTo(0, 11); ctx.moveTo(-5, 11); ctx.lineTo(5, 11);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.stroke();
    ctx.strokeStyle = '#1a1b20'; ctx.lineWidth = 2; ctx.stroke();
  } else if (shape === 'hand') {
    ctx.moveTo(-3, 7); ctx.lineTo(-3, -3); ctx.quadraticCurveTo(-1, -7, 1, -3); ctx.lineTo(1, 5);
    ctx.bezierCurveTo(7, 1, 13, 6, 13, 10); ctx.lineTo(11, 20); ctx.lineTo(2, 20);
    ctx.lineTo(-7, 10); ctx.quadraticCurveTo(-8, 5, -3, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.moveTo(0, 0); ctx.lineTo(0, 25); ctx.lineTo(6.5, 19); ctx.lineTo(12, 30);
    ctx.lineTo(16.5, 27.5); ctx.lineTo(11, 17); ctx.lineTo(20, 17); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
