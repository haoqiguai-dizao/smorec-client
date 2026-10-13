import type { BoardCameraAppearance, BoardRecording } from './types';
import type { BoardScene } from './model';
import { boardLayoutFrameAt } from './layout';

export const CAMERA_BOARD_DURATION = 1.1;
export const CAMERA_BOARD_COLORS = ['#fffaf4', '#ffe28a', '#ff999d', '#86b4ff', '#86dbbb'] as const;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
function bezier(value: number, x1: number, y1: number, x2: number, y2: number): number {
  if (value <= 0 || value >= 1) return value;
  const coordinate = (t: number, a: number, b: number) => 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
  let low = 0, high = 1;
  for (let n = 0; n < 18; n++) {
    const middle = (low + high) / 2;
    if (coordinate(middle, x1, x2) < value) low = middle; else high = middle;
  }
  return coordinate((low + high) / 2, y1, y2);
}
/** One timing model for local preview, recording playback and encoded export. */
export function cameraBoardMotion(appearance: BoardCameraAppearance, elapsed = Infinity) {
  const transition = appearance.cameraTransition, entering = transition?.direction !== 'exit';
  const progress = transition ? clamp(elapsed / transition.duration) : 1;
  const camera = bezier(clamp((progress - (entering ? 0 : .1)) / .94), .22, 1, .36, 1);
  const shade = bezier(clamp((progress - (entering ? .14 : 0)) / (entering ? .77 : .48)), .33, 0, .2, 1);
  const ink = bezier(clamp((progress - (entering ? .61 : 0)) / .32), .22, 1, .36, 1);
  return { camera: entering ? camera : 1 - camera, shade: (appearance.shade ?? .4) * (entering ? shade : 1 - shade),
    ink: entering ? ink : 1 - ink, finished: progress >= 1 };
}
export function cameraBoardAt(recording: BoardRecording | undefined, time: number) {
  if (!recording) return undefined;
  const frame = boardLayoutFrameAt(recording, time), layout = frame?.action;
  if (!layout?.visible) return undefined;
  const elapsed = time - (frame?.t ?? time);
  if (layout.backdrop !== 'camera' && (!layout.cameraTransition || layout.cameraTransition.direction !== 'exit'
    || elapsed >= layout.cameraTransition.duration)) return undefined;
  return { layout, ...cameraBoardMotion(layout, elapsed) };
}
/** Preserve the stored colour and history; only adapt neutral ink to its visible surface. */
export function boardSceneForBackdrop(scene: BoardScene, camera: boolean): BoardScene {
  const color = (value: string) => camera ? value === '#20242c' ? '#fffaf4' : value
    : value === '#fffaf4' ? '#20242c' : value === '#ffe28a' ? '#9b6b00' : value;
  return { ...scene, items: scene.items.map(item => ({ ...item, color: color(item.color) })) };
}
