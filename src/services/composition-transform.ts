import { getExportCanvasSize } from '../../shared/canvas';
import { webcamStyleAt } from '../../shared/camera-layout';
import { COMPOSITION_CAMERA_MIN_SIZE, compositionCameraRect } from '../../shared/composition-camera';
import { cameraAt } from '../../shared/timeline';
import type { CompositionCamera, CompositionSegment, Project } from '../../shared/types';
import { frameContentAt } from '../../shared/frame-content';

export function compositionTransformState(project: Project, segment: CompositionSegment, sourceTime: number) {
  if (!project.camera) return undefined;
  const output = getExportCanvasSize(project);
  const time = Math.max(segment.start, Math.min(segment.end - 1e-7, sourceTime));
  const style = webcamStyleAt(project.camera, time);
  const rect = compositionCameraRect(style, segment.camera, output.width, output.height, cameraAt(project.zooms, time).scale);
  return { output, style, rect, editable: !frameContentAt(project, time, segment).cameraEmbedded };
}

export type CompositionTransformMode = 'move' | 'nw' | 'ne' | 'se' | 'sw';
export interface CompositionTransformStart {
  mode: CompositionTransformMode;
  rect: { x: number; y: number; width: number; height: number };
  output: { width: number; height: number };
  viewport: { width: number; height: number };
  clientX: number;
  clientY: number;
}
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function transformCompositionCamera(start: CompositionTransformStart, clientX: number, clientY: number): CompositionCamera {
  const { rect, output, viewport } = start;
  const dx = (clientX - start.clientX) / Math.max(1, viewport.width) * output.width;
  const dy = (clientY - start.clientY) / Math.max(1, viewport.height) * output.height;
  if (start.mode === 'move') return {
    x: clamp(rect.x + dx, 0, output.width - rect.width) / output.width,
    y: clamp(rect.y + dy, 0, output.height - rect.height) / output.height,
  };
  const left = start.mode.includes('w'), top = start.mode.includes('n');
  const anchorX = left ? rect.x + rect.width : rect.x, anchorY = top ? rect.y + rect.height : rect.y;
  const aspect = rect.width / Math.max(1, rect.height);
  const growth = ((left ? -dx : dx) * rect.width + (top ? -dy : dy) * rect.height)
    / Math.max(1, rect.width * rect.width + rect.height * rect.height);
  const maximum = Math.min(left ? anchorX : output.width - anchorX, (top ? anchorY : output.height - anchorY) * aspect);
  const width = clamp(rect.width * (1 + growth), Math.min(maximum, Math.min(output.width, output.height) * COMPOSITION_CAMERA_MIN_SIZE), maximum);
  const height = width / aspect;
  return { x: (left ? anchorX - width : anchorX) / output.width,
    y: (top ? anchorY - height : anchorY) / output.height, size: width / Math.min(output.width, output.height) };
}
