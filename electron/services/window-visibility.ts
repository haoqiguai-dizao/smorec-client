import type { BrowserWindow, Rectangle } from 'electron';

// Reserve room for auto-hidden taskbars and desktop docks as well as normal work areas.
export const FLOATING_BAR_BOTTOM_GAP = 96;

type VisibleWindow = Pick<BrowserWindow, 'isDestroyed' | 'isMinimized' | 'isVisible' | 'restore' | 'getBounds' | 'setBounds'
  | 'getMinimumSize' | 'setMinimumSize' | 'show' | 'focus'>;

/** Keep the whole editor in the most-overlapped display, or the primary display first in the list. */
export function visibleWindowBounds(bounds: Rectangle, workAreas: Rectangle[]): Rectangle {
  if (!workAreas.length) return bounds;
  let area = workAreas[0], overlap = 0;
  for (const candidate of workAreas) {
    const width = Math.max(0, Math.min(bounds.x + bounds.width, candidate.x + candidate.width) - Math.max(bounds.x, candidate.x));
    const height = Math.max(0, Math.min(bounds.y + bounds.height, candidate.y + candidate.height) - Math.max(bounds.y, candidate.y));
    if (width * height > overlap) { area = candidate; overlap = width * height; }
  }
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height,
    x: overlap ? Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)) : Math.round(area.x + (area.width - width) / 2),
    y: overlap ? Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)) : Math.round(area.y + (area.height - height) / 2) };
}

/** Event-driven only: no timer or background loop is allowed to steal focus. */
export function revealWindow(window: VisibleWindow | undefined, workAreas: Rectangle[]): void {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  const previous = window.getBounds(), bounds = visibleWindowBounds(previous, workAreas);
  if (bounds.x !== previous.x || bounds.y !== previous.y || bounds.width !== previous.width || bounds.height !== previous.height) {
    const [minimumWidth, minimumHeight] = window.getMinimumSize();
    if (minimumWidth > bounds.width || minimumHeight > bounds.height) {
      window.setMinimumSize(Math.min(minimumWidth, bounds.width), Math.min(minimumHeight, bounds.height));
    }
    window.setBounds(bounds);
  }
  window.show();
  // Windows STARTUPINFO can consume a first show as hidden; retry only if still hidden.
  if (!window.isVisible()) window.show();
  window.focus();
}
