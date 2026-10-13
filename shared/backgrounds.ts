import type { CompositionSegment } from './types';

/** Local screen choices override the canvas background, including explicit hiding. */
export function effectiveBackground(fallback: string, segment?: CompositionSegment): string | undefined {
  if (segment?.screen === 'hidden') return;
  return segment?.screen === 'background' ? segment.background : fallback;
}
