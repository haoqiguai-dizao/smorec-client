import type { CameraEffects } from './types';

export const BEAUTY_FIELDS = ['skinWhitening', 'rosiness', 'faceSlim', 'faceSize', 'jaw', 'chin',
  'eyeEnlarge', 'eyeDistance', 'noseSlim', 'mouthSize', 'eyeBrightening', 'teethWhitening'] as const;
export type BeautyField = typeof BEAUTY_FIELDS[number];
export const BEAUTY_ZERO = Object.fromEntries(BEAUTY_FIELDS.map(key => [key, 0])) as Record<BeautyField, number>;
export const beautyValue = (value: number | undefined) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value!)) : 0;
export const SIGNED_BEAUTY_FIELDS: readonly BeautyField[] = ['chin', 'eyeDistance', 'mouthSize'];
export function hasFaceEffects(effects?: CameraEffects): boolean {
  return !!effects?.enabled && BEAUTY_FIELDS.some(key => !!beautyValue(effects[key]));
}
