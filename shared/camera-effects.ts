import type { CameraEffects, WebcamStyle } from './types';
import { BEAUTY_FIELDS, BEAUTY_ZERO } from './beauty';

export const DEFAULT_CAMERA_EFFECTS: Readonly<CameraEffects> = {
  enabled: true, smoothing: 0.45, brightness: 0.12, filter: 'natural', intensity: 0.18,
};
export const ORIGINAL_CAMERA_EFFECTS: Readonly<CameraEffects> = {
  enabled: false, smoothing: 0, brightness: 0, filter: 'natural', intensity: 0,
};
/** Presets store ordinary effect values; no new persistence format or hidden state. */
export const CAMERA_BEAUTY_PRESETS: readonly { id: string; label: string; effects: Readonly<CameraEffects> }[] = [
  { id: 'natural', label: '自然肤质', effects: DEFAULT_CAMERA_EFFECTS },
  { id: 'soft', label: '细腻柔肤', effects: { ...BEAUTY_ZERO, enabled: true, smoothing: 0.75, brightness: 0.14, filter: 'natural', intensity: 0.15, skinWhitening: 0.15, rosiness: 0.1 } },
  { id: 'bright', label: '明亮上镜', effects: { ...BEAUTY_ZERO, enabled: true, smoothing: 0.65, brightness: 0.32, filter: 'natural', intensity: 0.2, skinWhitening: 0.22, eyeBrightening: 0.15, teethWhitening: 0.25 } },
];

export function cameraBeautyPreset(effects: CameraEffects): string | undefined {
  return CAMERA_BEAUTY_PRESETS.find(preset => BEAUTY_FIELDS.every(key => (preset.effects[key] ?? 0) === (effects[key] ?? 0))
    && (['enabled', 'smoothing', 'brightness', 'filter', 'intensity'] as const).every(key => preset.effects[key] === effects[key]))?.id;
}
export const CAMERA_FILTERS = [
  { id: 'natural', label: '自然' }, { id: 'warm', label: '暖调' },
  { id: 'cool', label: '冷调' }, { id: 'mono', label: '黑白' },
] as const;

/** Exact step changes on source time; old projects without effects remain original. */
export function cameraEffectsAt(style: WebcamStyle, time: number): CameraEffects {
  const frames = style.effectKeyframes;
  if (style.useRecordedEffects === false || !frames?.length) return { ...(style.effects ?? ORIGINAL_CAMERA_EFFECTS) };
  let low = 0, high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].t <= time) low = middle; else high = middle - 1;
  }
  return { ...frames[low].effects };
}
