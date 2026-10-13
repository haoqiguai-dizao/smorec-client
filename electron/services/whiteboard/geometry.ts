import type { Rectangle } from 'electron';
import type { CaptureSource, RecordingOptions } from '../../../shared/types';
import { BOARD_HEADER_HEIGHT, BOARD_TOOLBAR_HEIGHT, type BoardBounds } from '../../../shared/whiteboard/types';

export const BOARD_CHROME_HEIGHT = BOARD_HEADER_HEIGHT + BOARD_TOOLBAR_HEIGHT;
/** Camera/ink still fill the capture area; only controls avoid system chrome. Units are DIP. */
export function boardControlInsets(bounds: Rectangle, workArea: Rectangle, platform = process.platform) {
  const limitX = Math.max(0, (bounds.width - 320) / 2), limitY = Math.max(0, (bounds.height - 180) / 2);
  const bottom = Math.max(8, bounds.y + bounds.height - workArea.y - workArea.height + 8,
    platform === 'darwin' && bounds.y + bounds.height >= workArea.y + workArea.height - 8 ? 96 : 8);
  return { top: Math.min(limitY, Math.max(8, workArea.y - bounds.y + 8)),
    bottom: Math.min(limitY, bottom), left: Math.min(limitX, Math.max(8, workArea.x - bounds.x + 8)),
    right: Math.min(limitX, Math.max(8, bounds.x + bounds.width - workArea.x - workArea.width + 8)) };
}
export function recordingArea(source: CaptureSource, options: RecordingOptions, bounds: Rectangle): Rectangle {
  const crop = options.crop;
  if (!crop) return bounds;
  return { x: bounds.x + crop.x / source.width * bounds.width, y: bounds.y + crop.y / source.height * bounds.height,
    width: crop.width / source.width * bounds.width, height: crop.height / source.height * bounds.height };
}
// Keep controls inside the display work area, with room away from auto-hidden Dock edges.
export function usableBoardArea(area: Rectangle, workArea: Rectangle): Rectangle {
  const x = Math.max(area.x, workArea.x + 8), y = Math.max(area.y, workArea.y + 8);
  return { x, y, width: Math.max(0, Math.min(area.x + area.width, workArea.x + workArea.width - 8) - x),
    height: Math.max(0, Math.min(area.y + area.height, workArea.y + workArea.height - 8) - y) };
}
export function clampBoard(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(area.width, Math.max(320, bounds.width));
  const height = Math.min(area.height, Math.max(250, bounds.height));
  return { x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))), width: Math.round(width), height: Math.round(height) };
}
export function boardBounds(bounds: Rectangle, area: Rectangle, maximized = false): BoardBounds {
  if (maximized) return boardWindowBounds(bounds, area);
  // Native window coordinates are integers; cropped Retina areas can contain fractions.
  const x = Math.max(0, (bounds.x - area.x) / area.width);
  const y = Math.max(0, (bounds.y + BOARD_HEADER_HEIGHT - area.y) / area.height);
  return { x, y, width: Math.min(1 - x, bounds.width / area.width),
    height: Math.min(1 - y, (bounds.height - BOARD_CHROME_HEIGHT) / area.height) };
}
export function boardWindowBounds(bounds: Rectangle, area: Rectangle): BoardBounds {
  const x = Math.max(0, (bounds.x - area.x) / area.width);
  const y = Math.max(0, (bounds.y - area.y) / area.height);
  return { x, y, width: Math.min(1 - x, bounds.width / area.width),
    height: Math.min(1 - y, bounds.height / area.height) };
}
