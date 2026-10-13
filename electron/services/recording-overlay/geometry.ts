import type { Rectangle } from 'electron';
import { FLOATING_BAR_BOTTOM_GAP } from '../window-visibility';
import { LAUNCHER_COLLAPSED_HEIGHT } from '../recorder-launcher/geometry';
import { cameraShapeGeometry, type CameraShape } from '../../../shared/camera-shapes';
export interface CameraCenter { x: number; y: number }
export const CAMERA_WINDOW_PADDING = 6;
export const PRESENTER_SAFE_MARGIN = 24;
export const TOOLBAR_WIDTH = 466;
export const TOOLBAR_COLLAPSED_HEIGHT = 78;
export const TOOLBAR_EXPANDED_HEIGHT = 420;
/** Correct an integer-DIP request against the actual native readback, without accumulating enclosing-rect rounding. */
export function adjustBoundsForReadback(request: Rectangle, observed: Rectangle, target: Rectangle): Rectangle {
  return { x: request.x + target.x - observed.x, y: request.y + target.y - observed.y,
    width: Math.max(1, request.width + target.width - observed.width), height: Math.max(1, request.height + target.height - observed.height) };
}
export function clampOverlayBounds(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))) };
}
export function cameraOverlayBounds(area: Rectangle, size: number, center: CameraCenter, shape: CameraShape = 'circle'): Rectangle {
  const edge = Math.round(Math.min(area.width, area.height) * Math.max(.12, Math.min(.42, Number.isFinite(size) ? size : .22)));
  const frame = cameraShapeGeometry(shape, edge, Math.max(0, area.width - CAMERA_WINDOW_PADDING * 2), Math.max(0, area.height - CAMERA_WINDOW_PADDING * 2));
  const width = Math.round(frame.width) + CAMERA_WINDOW_PADDING * 2, height = Math.round(frame.height) + CAMERA_WINDOW_PADDING * 2;
  const x = Number.isFinite(center.x) ? Math.max(0, Math.min(1, center.x)) : .5;
  const y = Number.isFinite(center.y) ? Math.max(0, Math.min(1, center.y)) : .5;
  return clampOverlayBounds({ x: area.x + area.width * x - width / 2, y: area.y + area.height * y - height / 2,
    width, height }, area);
}
export function cameraOverlayCenter(bounds: Rectangle, area: Rectangle): CameraCenter {
  return { x: Math.max(0, Math.min(1, (bounds.x + bounds.width / 2 - area.x) / area.width)),
    y: Math.max(0, Math.min(1, (bounds.y + bounds.height / 2 - area.y) / area.height)) };
}
/** Reserve both logical and readback centers so fractional-DPI rounding cannot move a live slider. */
export function cameraSettingsReserve(bounds: Rectangle, area: Rectangle, center: CameraCenter, shape: CameraShape): Rectangle {
  const candidates = [bounds, cameraOverlayBounds(area, .42, center, shape),
    cameraOverlayBounds(area, .42, cameraOverlayCenter(bounds, area), shape)];
  const x = Math.min(...candidates.map(item => item.x)), y = Math.min(...candidates.map(item => item.y));
  return { x, y, width: Math.max(...candidates.map(item => item.x + item.width)) - x,
    height: Math.max(...candidates.map(item => item.y + item.height)) - y };
}
/** Fit the selected camera aspect inside the work area; retain the shadow gutter. */
export function presenterCameraBounds(area: Rectangle, center: CameraCenter = { x: .5, y: .5 }, aspect: '16:9' | '9:16' = '16:9'): Rectangle {
  const padding = CAMERA_WINDOW_PADDING * 2;
  const margin = Math.min(PRESENTER_SAFE_MARGIN, Math.max(0, (Math.min(area.width, area.height) - padding - 16) / 2));
  const safe = { x: area.x + margin, y: area.y + margin, width: area.width - margin * 2, height: area.height - margin * 2 };
  if (aspect === '9:16') {
    // Keep the portrait preview above the default recording bar, including its desktop gap.
    const bottomReserve = FLOATING_BAR_BOTTOM_GAP + Math.max(LAUNCHER_COLLAPSED_HEIGHT, TOOLBAR_COLLAPSED_HEIGHT) + 12;
    safe.height = Math.max(padding + 16, safe.height - Math.max(0, bottomReserve - margin));
  }
  const [w, h] = aspect === '9:16' ? [9, 16] : [16, 9];
  const widthLimit = Math.min(960, area.width * .65, Math.max(0, safe.width - padding), Math.max(0, safe.height - padding) * w / h);
  const unit = Math.max(1, Math.floor(widthLimit / w));
  const width = unit * w + padding, height = unit * h + padding;
  const x = Number.isFinite(center.x) ? Math.max(0, Math.min(1, center.x)) : .5;
  const y = Number.isFinite(center.y) ? Math.max(0, Math.min(1, center.y)) : .5;
  return clampOverlayBounds({ x: area.x + area.width * x - width / 2, y: area.y + area.height * y - height / 2, width, height }, safe);
}
export function toolbarOverlayBounds(area: Rectangle, expanded: boolean): Rectangle {
  const height = expanded ? TOOLBAR_EXPANDED_HEIGHT : TOOLBAR_COLLAPSED_HEIGHT;
  return clampOverlayBounds({ x: area.x + (area.width - TOOLBAR_WIDTH) / 2,
    y: area.y + area.height - height - FLOATING_BAR_BOTTOM_GAP, width: TOOLBAR_WIDTH, height }, area);
}
