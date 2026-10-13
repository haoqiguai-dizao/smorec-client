import { cameraAt, cursorAt, sampleIndexAt } from '../../shared/timeline';
import type { Project } from '../../shared/types';
import { drawCursor } from './cursor-renderer';
import { drawPresenter, drawWebcam, type CameraRenderMode } from './webcam-compositor';
import { webcamStyleAt } from '../../shared/camera-layout';
import { frameContentAt } from '../../shared/frame-content';
import { compositionCameraStyle } from '../../shared/composition-camera';
import { drawCompositionDecoration, screenGeometry } from './compositor-decoration';
import { drawRecordedBoard } from './whiteboard-renderer';
import { drawCameraWhiteboard } from './whiteboard-camera-compositor';
import { cameraBoardAt } from '../../shared/whiteboard/camera-scene';
export { getExportCanvasSize as getCanvasSize } from '../../shared/canvas';

/** Single compositor used by both the editor and encoded export, at source time. */
export function renderFrame(ctx: CanvasRenderingContext2D, video: CanvasImageSource | undefined, project: Project, time: number, width: number, height: number,
  webcam?: CanvasImageSource, cameraMode: CameraRenderMode = 'source', replacementBackground?: CanvasImageSource,
  liveCamera?: { x: number; y: number; scale: number }, whiteboard?: CanvasImageSource) {
  const { style } = project;
  const content = frameContentAt(project, time), { composition } = content;
  const cameraBoard = cameraBoardAt(project.whiteboard, time);
  const camera = content.screenZoomLocked ? { x: .5, y: .5, scale: 1 } : liveCamera ?? cameraAt(project.zooms, time);
  ctx.save();
  try {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (content.presenter) {
    // A missing/disabled camera must never expose the screen underneath a presenter segment.
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#13151a'; ctx.fillRect(0, 0, width, height);
    const cameraStyle = project.camera && webcamStyleAt(project.camera, time);
    // Recorded visibility belongs to the small window; the master switch still applies.
    if (webcam && content.camera && cameraStyle) drawPresenter(ctx, webcam, cameraStyle, width, height, cameraMode);
    if (project.whiteboard) {
      const boardWidth = width * camera.scale, boardHeight = height * camera.scale;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
      drawRecordedBoard(ctx, project.whiteboard, time,
        width / 2 - camera.x * boardWidth, height / 2 - camera.y * boardHeight,
        boardWidth, boardHeight, project.id, whiteboard, video);
      ctx.restore();
    }
    drawCameraWhiteboard(ctx, webcam, project, time, width, height, cameraMode);
    return;
  }
  drawCompositionDecoration(ctx, project, width, height, composition, replacementBackground);
  if (video && content.screen) {
  const { unit, frameWidth, frameHeight, left, top, radius } = screenGeometry(project, width, height);
  ctx.save();
  ctx.beginPath(); ctx.roundRect(left, top, frameWidth, frameHeight, radius); ctx.clip();
  const drawWidth = frameWidth * camera.scale, drawHeight = frameHeight * camera.scale;
  const drawLeft = left + frameWidth / 2 - camera.x * drawWidth;
  const drawTop = top + frameHeight / 2 - camera.y * drawHeight;
  ctx.drawImage(video, drawLeft, drawTop, drawWidth, drawHeight);
  if (!content.embeddedInterface || project.whiteboard?.separateCanvas)
    drawRecordedBoard(ctx, project.whiteboard, time, drawLeft, drawTop, drawWidth, drawHeight, project.id, whiteboard);
  if (style.showCursor) {
    const cursor = cursorAt(project.cursor, time, style.smoothing);
    if (style.clickHighlight) {
      const index = sampleIndexAt(project.cursor, time);
      for (let i = Math.min(index, project.cursor.length - 1); i >= 0 && project.cursor[i].t >= time - 0.45; i--) {
        const sample = project.cursor[i];
        if (!sample.click || !sample.visible || sample.t > time) continue;
        const progress = (time - sample.t) / 0.45;
        ctx.beginPath();
        ctx.arc(drawLeft + sample.x * drawWidth, drawTop + sample.y * drawHeight, (10 + progress * 25) * unit * style.cursorScale, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${(1 - progress) * 0.8})`;
        ctx.lineWidth = 3 * unit;
        ctx.stroke();
      }
    }
    if (cursor?.visible) drawCursor(ctx, drawLeft + cursor.x * drawWidth, drawTop + cursor.y * drawHeight, style.cursorScale * unit, cursor.shape);
  }
  ctx.restore();
  ctx.strokeStyle = '#ffffff25'; ctx.lineWidth = unit;
  ctx.beginPath(); ctx.roundRect(left + 0.5, top + 0.5, frameWidth - 1, frameHeight - 1, radius); ctx.stroke();
  }
  if (webcam && project.camera && content.camera && !cameraBoard) {
    const sourceStyle = webcamStyleAt(project.camera, time);
    const cameraStyle = composition ? compositionCameraStyle(sourceStyle, composition.camera, width, height, camera.scale) : sourceStyle;
    if (cameraStyle.enabled) drawWebcam(ctx, webcam, cameraStyle, width, height, camera.scale, cameraMode);
  }
  if (cameraBoard) {
    // Camera boards were written in the capture viewport. Keep camera, shade and
    // ink in that same source frame when the editor changes aspect or framing.
    const { left, top, frameWidth, frameHeight, radius } = screenGeometry(project, width, height);
    const boardWidth = frameWidth * camera.scale, boardHeight = frameHeight * camera.scale;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(left, top, frameWidth, frameHeight, radius); ctx.clip();
    ctx.translate(left + frameWidth / 2 - camera.x * boardWidth, top + frameHeight / 2 - camera.y * boardHeight);
    drawCameraWhiteboard(ctx, webcam, project, time, boardWidth, boardHeight, cameraMode);
    ctx.restore();
  }
  } finally { ctx.restore(); }
}
