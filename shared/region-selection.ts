import type { CaptureSource, Rect } from './types';
export interface RegionSelectionConfiguration { source: CaptureSource; initial?: Rect }
export interface RegionSelectionApi {
  select(sourceId: string, initial?: Rect): Promise<Rect | null>;
  configuration(): Promise<RegionSelectionConfiguration>;
  complete(crop: Rect): Promise<void>;
  cancel(): Promise<void>;
}
declare global { interface Window { regionSelection?: RegionSelectionApi } }
export function validRegion(rect: unknown, width: number, height: number): rect is Rect {
  if (!rect || typeof rect !== 'object' || Array.isArray(rect)) return false;
  const value = rect as Rect;
  return Object.keys(value).length === 4 && ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(value[key as keyof Rect]))
    && value.x >= 0 && value.y >= 0 && value.width >= 32 && value.height >= 32
    && value.x + value.width <= width && value.y + value.height <= height;
}
export function selectionRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}
export function physicalRegion(rect: Rect, viewport: { width: number; height: number }, source: { width: number; height: number }): Rect {
  const left = Math.max(0, Math.min(source.width, Math.round(rect.x / viewport.width * source.width)));
  const top = Math.max(0, Math.min(source.height, Math.round(rect.y / viewport.height * source.height)));
  const right = Math.max(left, Math.min(source.width, Math.round((rect.x + rect.width) / viewport.width * source.width)));
  const bottom = Math.max(top, Math.min(source.height, Math.round((rect.y + rect.height) / viewport.height * source.height)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
