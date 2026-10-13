import type { BrowserWindow } from 'electron';
import type { BoardWindowOptions } from '../../../shared/whiteboard/types';

export const defaultBoardWindowOptions = (): BoardWindowOptions => ({ pinned: false, transparent: false, passthrough: false });

export function parseBoardWindowOptions(value: unknown): Partial<BoardWindowOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('白板窗口设置无效');
  const parsed: Partial<BoardWindowOptions> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'transparency') {
      if (typeof item !== 'number' || !Number.isFinite(item) || item < 0 || item > 1) throw new Error('白板透明度无效');
      parsed.transparency = item; continue;
    }
    if (!['pinned', 'transparent', 'passthrough'].includes(key) || typeof item !== 'boolean') throw new Error('白板窗口设置无效');
    parsed[key as 'pinned' | 'transparent' | 'passthrough'] = item;
  }
  return parsed;
}

export function applyBoardWindowOptions(window: BrowserWindow, options: BoardWindowOptions) {
  window.setAlwaysOnTop(options.pinned, 'floating');
  window.setIgnoreMouseEvents(options.passthrough, { forward: true });
  window.setBackgroundColor(options.transparent ? '#00000000' : '#ffffff');
  window.setHasShadow(!options.transparent);
  // CSS transparency is not sufficient for Chromium's Windows occlusion detector.
  // An explicit non-opaque native alpha keeps covered browser videos rendering.
  if (process.platform === 'win32') window.setOpacity(254 / 255);
}
