import type { Rectangle } from 'electron';

/** The collapsed bar is the stable anchor, even when an expanded panel is clamped. */
export function collapsedBarAnchor(bounds: Rectangle, collapsedHeight: number): Rectangle {
  return { ...bounds, y: bounds.y + bounds.height - collapsedHeight, height: collapsedHeight };
}

export function resizeFromAnchor(anchor: Rectangle, area: Rectangle, height: number): Rectangle {
  const width = Math.min(anchor.width, area.width), visibleHeight = Math.min(height, area.height);
  return { width, height: visibleHeight,
    x: Math.round(Math.max(area.x, Math.min(anchor.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(anchor.y + anchor.height - height, area.y + area.height - visibleHeight))) };
}

/** Relative travel preserves left/right and top/bottom placement across monitor sizes. */
export function remapBarAnchor(anchor: Rectangle, previousArea: Rectangle, targetArea: Rectangle): Rectangle {
  const fraction = (position: number, origin: number, available: number) =>
    available > 0 ? Math.max(0, Math.min(1, (position - origin) / available)) : .5;
  const width = Math.min(anchor.width, targetArea.width), height = Math.min(anchor.height, targetArea.height);
  return { width, height,
    x: Math.round(targetArea.x + fraction(anchor.x, previousArea.x, previousArea.width - anchor.width) * (targetArea.width - width)),
    y: Math.round(targetArea.y + fraction(anchor.y, previousArea.y, previousArea.height - anchor.height) * (targetArea.height - height)) };
}
