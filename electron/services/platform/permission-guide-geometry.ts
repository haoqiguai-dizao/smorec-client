import type { Rectangle } from 'electron';

export const PERMISSION_GUIDE_SIZE = { width: 520, bodyHeight: 88, footerHeight: 44 };
/** Keep the entire guide outside Settings so lowering its window never hides the component strips. */
export function permissionGuideBounds(area: Rectangle, settings?: Rectangle): Rectangle {
  const contentWidth = settings ? settings.width * .69 : area.width;
  const bodyHeight = PERMISSION_GUIDE_SIZE.bodyHeight;
  const width = Math.round(Math.min(PERMISSION_GUIDE_SIZE.width, Math.max(240, contentWidth - 24), area.width));
  const height = Math.min(bodyHeight + PERMISSION_GUIDE_SIZE.footerHeight, area.height);
  const clamp = (x: number, y: number) => ({ width, height,
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))) });
  if (!settings) return clamp(area.x + (area.width - width) / 2, area.y + area.height - height - 24);
  const gap = 12;
  const x = settings.x + settings.width - contentWidth + (contentWidth - width) / 2;
  const below = settings.y + settings.height + gap;
  if (below + height <= area.y + area.height) return clamp(x, below);
  const right = settings.x + settings.width + gap;
  if (right + width <= area.x + area.width) return clamp(right, settings.y + settings.height - height);
  const left = settings.x - width - gap;
  if (left >= area.x) return clamp(left, settings.y + settings.height - height);
  const above = settings.y - height - gap;
  if (above >= area.y) return clamp(x, above);
  return clamp(x, below);
}
