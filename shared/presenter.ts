import { cameraZoom } from './camera-zoom';

export type PresenterAspect = '16:9' | '9:16';
export interface PresenterCrop { x: number; y: number }
export interface PresenterSettings { aspect: PresenterAspect; crop: PresenterCrop }
export const DEFAULT_PRESENTER: PresenterSettings = { aspect: '16:9', crop: { x: .5, y: .5 } };
export const isPresenterAspect = (value: unknown): value is PresenterAspect => value === '16:9' || value === '9:16';
export function parsePresenterCrop(value: unknown): PresenterCrop {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('口播取景位置无效');
  const { x, y } = value as PresenterCrop;
  if (![x, y].every(item => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1)) throw new Error('口播取景位置无效');
  return { x, y };
}
export function parsePresenterSettings(value: unknown): PresenterSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('口播画幅无效');
  const { aspect, crop } = value as PresenterSettings;
  if (!isPresenterAspect(aspect)) throw new Error('口播画幅无效');
  return { aspect, crop: parsePresenterCrop(crop) };
}
/** Cover preserves source proportions; normalized alignment also applies after digital zoom. */
export function presenterSourceRect(sourceWidth: number, sourceHeight: number, width: number, height: number,
  crop: PresenterCrop = DEFAULT_PRESENTER.crop, zoom = 1) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight) * cameraZoom(zoom);
  const w = width / scale, h = height / scale;
  return { x: (sourceWidth - w) * crop.x, y: (sourceHeight - h) * crop.y, width: w, height: h };
}
