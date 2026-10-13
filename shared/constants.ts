import type { CanvasStyle } from './types';
import { FILL_CANVAS_STYLE } from './canvas-style';

export const DEFAULT_STYLE: CanvasStyle = {
  background: 'ocean', ...FILL_CANVAS_STYLE,
  cursorScale: 1.5, smoothing: 0.65,
  showCursor: true, clickHighlight: true,
};
export const BACKGROUNDS = [
  { id: 'ocean', name: '深海', colors: ['#97c4db', '#6b84b8', '#363c76'] },
  { id: 'dusk', name: '暮光', colors: ['#efb998', '#bc8ab6', '#6266ae'] },
  { id: 'mint', name: '薄荷', colors: ['#cef0d7', '#87c8bf', '#578ba1'] },
  { id: 'sand', name: '暖沙', colors: ['#f7e8cc', '#ddc5a5', '#b29a87'] },
  { id: 'ink', name: '墨色', colors: ['#404349', '#25272c', '#141619'] },
  { id: 'paper', name: '白纸', colors: ['#f6f6f3', '#ebebe7', '#dfdfdc'] },
] as const;
