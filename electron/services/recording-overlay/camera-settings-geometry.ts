import type { Rectangle } from 'electron';

const GAP = 8, GUTTER = 6;
const PREFERRED_WIDTH = 300, PREFERRED_HEIGHT = 540;
type Side = 'right' | 'left' | 'bottom' | 'top';
export interface CameraSettingsGeometry { bounds: Rectangle; settings: Rectangle; side: Side }
const clamp = (value: number, start: number, available: number, size: number) => Math.max(start, Math.min(value, start + available - size));

/** Places controls beside an unchanged camera rectangle, in the same native window. All values are DIP. */
export function cameraSettingsGeometry(camera: Rectangle, area: Rectangle): CameraSettingsGeometry {
  const spaces = { right: area.x + area.width - camera.x - camera.width - GAP, left: camera.x - area.x - GAP,
    bottom: area.y + area.height - camera.y - camera.height - GAP, top: camera.y - area.y - GAP };
  const candidates = (['right', 'left', 'bottom', 'top'] as const).map(side => {
    const horizontal = side === 'right' || side === 'left';
    const width = Math.floor(Math.min(PREFERRED_WIDTH, horizontal ? spaces[side] : area.width));
    const height = Math.floor(Math.min(PREFERRED_HEIGHT, horizontal ? area.height : spaces[side]));
    const x = side === 'right' ? camera.x + camera.width + GAP : side === 'left' ? camera.x - GAP - width
      : clamp(camera.x, area.x, area.width, width);
    const y = side === 'bottom' ? camera.y + camera.height + GAP : side === 'top' ? camera.y - GAP - height
      : clamp(camera.y, area.y, area.height, height);
    return { side, width, height, x, y, score: Math.min(width / PREFERRED_WIDTH, 1) * Math.min(height / PREFERRED_HEIGHT, 1) };
  }).filter(item => item.width >= 156 && item.height >= 112).sort((a, b) => b.score - a.score);
  const panel = candidates[0];
  if (!panel) throw new Error('屏幕边缘空间不足，请移动或缩小摄像头后打开画面设置');
  const left = Math.min(camera.x, panel.x), top = Math.min(camera.y, panel.y);
  return { side: panel.side,
    bounds: { x: left, y: top, width: Math.max(camera.x + camera.width, panel.x + panel.width) - left,
      height: Math.max(camera.y + camera.height, panel.y + panel.height) - top },
    settings: { x: panel.x + GUTTER, y: panel.y + GUTTER, width: panel.width - GUTTER * 2, height: panel.height - GUTTER * 2 } };
}
