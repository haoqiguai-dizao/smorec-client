import type { Project } from '../../shared/types';
import { cameraBoardAt, boardSceneForBackdrop } from '../../shared/whiteboard/camera-scene';
import { boardAt } from '../../shared/whiteboard/model';
import { webcamStyleAt } from '../../shared/camera-layout';
import { drawPresenter, type CameraRenderMode } from './webcam-compositor';
import { paintBoard } from './whiteboard-renderer';

const inkLayers = new WeakMap<CanvasRenderingContext2D, OffscreenCanvas>();

/** Shared by editor, export and live composition; no local-only transparency. */
export function drawCameraWhiteboard(ctx: CanvasRenderingContext2D, webcam: CanvasImageSource | undefined,
  project: Project, time: number, width: number, height: number, mode: CameraRenderMode): void {
  const scene = cameraBoardAt(project.whiteboard, time);
  if (!scene || !project.whiteboard) return;
  const from = scene.layout.cameraTransition?.camera ?? { x: .7, y: .7, width: .25, height: .25 };
  const x = from.x * (1 - scene.camera) * width, y = from.y * (1 - scene.camera) * height;
  const w = (from.width + (1 - from.width) * scene.camera) * width;
  const h = (from.height + (1 - from.height) * scene.camera) * height;
  ctx.save();
  // The transition opens the writing surface behind the expanding camera.
  if (scene.camera < .9999) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height); }
  ctx.translate(x, y); ctx.beginPath(); ctx.roundRect(0, 0, w, h, 12 * (1 - scene.camera)); ctx.clip();
  ctx.fillStyle = '#15171b'; ctx.fillRect(0, 0, w, h);
  if (webcam && project.camera?.enabled) {
    const style = webcamStyleAt(project.camera, time);
    drawPresenter(ctx, webcam, { ...style, presenterCrop: style.mode === 'presenter' ? style.presenterCrop : undefined }, w, h, mode);
  }
  ctx.globalAlpha = scene.shade; ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // A focused source frame can extend beyond the output. Keep its ink raster
  // within the output pixel budget while retaining its source aspect/coordinates.
  const budget = ctx.canvas?.width * ctx.canvas?.height || width * height;
  const inkScale = Math.min(1, Math.sqrt(budget / (width * height)));
  const inkWidth = Math.max(1, Math.round(width * inkScale)), inkHeight = Math.max(1, Math.round(height * inkScale));
  let ink = inkLayers.get(ctx);
  if (!ink) { ink = new OffscreenCanvas(inkWidth, inkHeight); inkLayers.set(ctx, ink); }
  if (ink.width !== inkWidth) ink.width = inkWidth;
  if (ink.height !== inkHeight) ink.height = inkHeight;
  // Legacy eraser strokes must erase only ink, never punch through the camera.
  paintBoard(ink.getContext('2d')! as unknown as CanvasRenderingContext2D,
    boardSceneForBackdrop(boardAt(project.whiteboard, time), true), inkWidth, inkHeight, project.id, true, time);
  ctx.save(); ctx.globalAlpha = scene.ink; ctx.drawImage(ink, 0, 0, width, height);
  ctx.restore();
}
