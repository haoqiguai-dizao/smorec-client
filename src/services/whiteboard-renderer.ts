import { boardAt, type BoardScene } from '../../shared/whiteboard/model';
import { BOARD_HEIGHT, BOARD_WIDTH, type BoardRecording } from '../../shared/whiteboard/types';
import { paintImage, paintLine, paintShape } from './whiteboard-elements';
import { paintBoardVideo } from './whiteboard-video-renderer';
import { boardLayoutAt } from '../../shared/whiteboard/video';
import { sourceSize } from './camera-effects/canvas';
import { boardViewport, boardElementBounds } from '../../shared/whiteboard/viewport';
import { paintBoardText } from './whiteboard-paint-text';
import { boardRevealAt } from '../../shared/whiteboard/motion';
import { boardSceneForBackdrop, cameraBoardAt } from '../../shared/whiteboard/camera-scene';
export { boardViewport } from '../../shared/whiteboard/viewport';

/** Render opaque white strokes for the eraser, including over text, on an opaque board. */
export function paintBoard(ctx: CanvasRenderingContext2D, scene: BoardScene, width: number, height: number, scope?: string,
  transparent = false, time = Infinity, clear = true): void {
  ctx.save();
  if (clear) ctx.clearRect(0, 0, width, height);
  if (!transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); }
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  const { scale, left, top } = boardViewport(width, height, scene.view);
  ctx.translate(left, top); ctx.scale(scale, scale);
  // Old recordings retain their original fixed-canvas clipping until the first viewport event.
  if (!scene.view) { ctx.beginPath(); ctx.rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT); ctx.clip(); }
  const visible = scene.items.filter(item => {
    const b = boardElementBounds(item, scene.items), margin = item.size * 5 + 8;
    return b.right + margin >= -left / scale && b.bottom + margin >= -top / scale
      && b.left - margin <= (width - left) / scale && b.top - margin <= (height - top) / scale;
  });
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const item of visible) if (item.kind === 'line')
    paintLine(ctx, item, scene.items, transparent, boardRevealAt(item, scene.reveals?.[item.id], time));
  for (const item of visible) {
    if (item.kind === 'line') continue;
    if (item.kind === 'shape') {
      paintShape(ctx, item, transparent, boardRevealAt(item, scene.reveals?.[item.id], time)); continue;
    }
    if (item.kind === 'image') { paintImage(ctx, item, scope, transparent); continue; }
    ctx.fillStyle = item.color;
    if (item.kind === 'text') {
      ctx.textBaseline = 'top';
      item.text.split('\n').forEach((line, i) => paintBoardText(ctx, line, item.x, item.y + i * item.size * 1.4,
        { color: item.color, size: item.size, transparent }));
    } else {
      if (transparent && item.color.toLowerCase() === '#ffffff') ctx.globalCompositeOperation = 'destination-out';
      const first = item.points[0];
      if (!first) continue;
      ctx.strokeStyle = item.color; ctx.lineWidth = item.size;
      if (item.points.length === 1) {
        ctx.beginPath(); ctx.arc(first.x, first.y, item.size / 2, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.moveTo(first.x, first.y);
        for (let i = 1; i < item.points.length; i++) ctx.lineTo(item.points[i].x, item.points[i].y);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.restore();
}
export function drawRecordedBoard(ctx: CanvasRenderingContext2D, recording: BoardRecording | undefined,
  time: number, left: number, top: number, width: number, height: number, scope?: string, interfaceFrame?: CanvasImageSource,
  embeddedFrame?: CanvasImageSource): void {
  if (!recording) return;
  const layout = boardLayoutAt(recording, time);
  if (!layout?.visible) return;
  if (layout.backdrop === 'camera' || cameraBoardAt(recording, time)) return;
  const complete = layout.presentation === 'interface';
  const embedded = complete && recording.interfaceCapture === 'screen';
  if (embedded && !embeddedFrame) return;
  const b = complete ? layout.windowBounds ?? layout.bounds : layout.bounds, w = b.width * width, h = b.height * height;
  ctx.save();
  ctx.translate(left + b.x * width, top + b.y * height);
  ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  if (embedded && embeddedFrame) {
    const source = sourceSize(embeddedFrame);
    ctx.drawImage(embeddedFrame, b.x * source.width, b.y * source.height, b.width * source.width, b.height * source.height, 0, 0, w, h);
  } else if (complete) {
    if (interfaceFrame) paintBoardVideo(ctx, interfaceFrame, recording, time, w, h);
    else { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  } else paintBoard(ctx, boardSceneForBackdrop(boardAt(recording, time), false), w, h, scope, false, time);
  ctx.restore();
}
