import type { Project } from '../types';
import { webcamStyleAt } from '../camera-layout';
import { compositionCameraRect } from '../composition-camera';
import { boardLayoutAt } from './layout';

/** A separately replayed opaque board can cover the PiP already burned into a demo screen. */
export function boardCoversRecordedCamera(project: Project, time: number): boolean {
  const board = project.whiteboard;
  if (!board?.separateCanvas || !project.media.camera || !project.camera) return false;
  const layout = boardLayoutAt(board, time);
  if (!layout?.visible || layout.presentation === 'interface' && board.interfaceCapture === 'screen') return false;
  const bounds = layout.presentation === 'interface' ? layout.windowBounds ?? layout.bounds : layout.bounds;
  // Screen pixels retain the recorded placement even after global layout edits.
  const recorded = webcamStyleAt({ ...project.camera, enabled: true, useRecordedLayout: true }, time);
  const rect = compositionCameraRect(recorded, undefined, project.width, project.height);
  const epsilon = 1e-6;
  return bounds.x * project.width <= rect.x + epsilon && (bounds.x + bounds.width) * project.width >= rect.x + rect.width - epsilon
    && bounds.y * project.height <= rect.y + epsilon && (bounds.y + bounds.height) * project.height >= rect.y + rect.height - epsilon;
}
