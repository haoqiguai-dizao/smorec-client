import type { CaptureSource } from '../../../shared/types';

export function sourceLabel(source: CaptureSource | undefined, sources: CaptureSource[]) {
  if (!source) return '';
  return source.kind === 'screen' ? `屏幕 ${sources.filter(item => item.kind === 'screen').findIndex(item => item.id === source.id) + 1}` : source.name;
}
