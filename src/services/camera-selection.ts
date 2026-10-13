import { getExportCanvasSize } from '../../shared/canvas';
import { webcamStyleAt } from '../../shared/camera-layout';
import { cameraShapeGeometry } from '../../shared/camera-shapes';
import { compositionAt } from '../../shared/composition';
import { compositionCameraRect } from '../../shared/composition-camera';
import { cameraAt } from '../../shared/timeline';
import type { Project } from '../../shared/types';
import { frameContentAt } from '../../shared/frame-content';

/** Hit region follows the displayed camera, independently of timeline selection. */
export function cameraSelectionState(project: Project, sourceTime: number, cameraAvailable = true) {
  if (!cameraAvailable || !project.media.camera || !project.camera || !Number.isFinite(sourceTime)) return;
  if (sourceTime + project.camera.offset < 0) return;
  const content = frameContentAt(project, sourceTime);
  if (!content.camera) return;
  const output = getExportCanvasSize(project), { width, height } = output;
  const style = webcamStyleAt(project.camera, sourceTime);
  const segment = compositionAt(project.compositions, sourceTime);
  if (!segment && content.presenter) {
    return project.camera.enabled ? { output, rect: { x: 0, y: 0, width, height, radius: 0 } } : undefined;
  }
  if (!(segment?.camera?.visible ?? style.enabled)) return;
  const zoom = cameraAt(project.zooms, sourceTime).scale;
  if (segment) return { output, rect: compositionCameraRect(style, segment.camera, width, height, zoom) };
  const shrink = style.shrinkOnZoom ? 1 - Math.min(1, Math.max(0, zoom - 1)) * .24 : 1;
  const rect = cameraShapeGeometry(style.shape, Math.min(width, height) * style.size * shrink, width, height);
  const gap = Math.min(width, height) * .035;
  // Unedited corner layouts use drawWebcam's gap, even when a fitted shape reaches the canvas edge.
  const x = style.placement ? Math.max(0, Math.min(width - rect.width, style.placement.x * width - rect.width / 2))
    : style.position.endsWith('right') ? width - gap - rect.width : gap;
  const y = style.placement ? Math.max(0, Math.min(height - rect.height, style.placement.y * height - rect.height / 2))
    : style.position.startsWith('bottom') ? height - gap - rect.height : gap;
  return { output, rect: { x, y, ...rect } };
}
