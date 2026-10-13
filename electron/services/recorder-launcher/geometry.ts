import type { Rectangle } from 'electron';
import { FLOATING_BAR_BOTTOM_GAP } from '../window-visibility';

export const LAUNCHER_WIDTH = 1120;
export const LAUNCHER_COLLAPSED_HEIGHT = 96;
export const LAUNCHER_EXPANDED_HEIGHT = 704;

export function clampLauncherBounds(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height,
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))) };
}

export function launcherBounds(area: Rectangle, expanded = false): Rectangle {
  const height = expanded ? LAUNCHER_EXPANDED_HEIGHT : LAUNCHER_COLLAPSED_HEIGHT;
  return clampLauncherBounds({ x: area.x + (area.width - LAUNCHER_WIDTH) / 2,
    y: area.y + area.height - height - FLOATING_BAR_BOTTOM_GAP, width: LAUNCHER_WIDTH, height }, area);
}

/** Keep the draggable bottom bar fixed while opening its settings above it. */
export function resizeLauncherBounds(bounds: Rectangle, area: Rectangle, expanded: boolean): Rectangle {
  const height = expanded ? LAUNCHER_EXPANDED_HEIGHT : LAUNCHER_COLLAPSED_HEIGHT;
  return clampLauncherBounds({ ...bounds, y: bounds.y + bounds.height - height, height }, area);
}
