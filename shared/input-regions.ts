import type { Rect } from './types';

/** Region coordinates are content DIPs, including on Retina displays. Empty restores the whole window. */
export function pointInsideRegions(x: number, y: number, regions: readonly Rect[]): boolean {
  return !regions.length || regions.some(rect => x >= rect.x && y >= rect.y
    && x < rect.x + rect.width && y < rect.y + rect.height);
}
