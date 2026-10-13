import type { CanvasStyle } from './types';

type FrameStyle = Pick<CanvasStyle, 'aspect' | 'padding' | 'radius' | 'shadow'>;

export const FILL_CANVAS_STYLE = { aspect: 'auto', padding: 0, radius: 0, shadow: 0 } as const satisfies FrameStyle;
export const BACKGROUND_CANVAS_STYLE = { padding: 64, radius: 20, shadow: 40 } as const;

export function isFillCanvasStyle(style: FrameStyle): boolean {
  return style.aspect === 'auto' && style.padding === 0 && style.radius === 0 && style.shadow === 0;
}

export function hasCanvasFrame(style: FrameStyle): boolean {
  return style.padding > 0 || style.radius > 0 || style.shadow > 0;
}
