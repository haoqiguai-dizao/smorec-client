import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron';
import type { ToolbarRegion } from '../../shared/toolbar-types';
import { trustedRecorderSender } from './recorder-launcher/validation';
import { trustedOverlaySender } from './recording-overlay/validation';
import type { setWindowInputRegions } from './platform/window-regions';

const channel = 'toolbar-presentation:regions';
export function parseToolbarRegions(value: unknown, bounds: { width: number; height: number }): ToolbarRegion[] {
  if (value === null) return [];
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) throw new Error('操作栏可见区域无效');
  return value.map(region => {
    if (!region || typeof region !== 'object' || Array.isArray(region)) throw new Error('操作栏区域无效');
    const { x, y, width, height } = region as ToolbarRegion;
    if (![x, y, width, height].every(item => typeof item === 'number' && Number.isFinite(item))
      || width <= 0 || height <= 0 || Math.abs(x) > 32768 || Math.abs(y) > 32768
      || width > 32768 || height > 32768) throw new Error('操作栏区域坐标无效');
    // Round outwards to retain the border/shadow at fractional DPI and clip to this window only.
    const left = Math.max(0, Math.floor(x)), top = Math.max(0, Math.floor(y));
    const right = Math.min(bounds.width, Math.ceil(x + width)), bottom = Math.min(bounds.height, Math.ceil(y + height));
    if (right - left < 8 || bottom - top < 8) throw new Error('操作栏可见区域超出窗口');
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

/** The resolver must return only a currently owned launcher/recording-toolbar instance. */
export function installToolbarPresentation({ ipcMain, resolveWindow, setRegions }: {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  resolveWindow: (event: IpcMainInvokeEvent) => BrowserWindow | undefined;
  setRegions: typeof setWindowInputRegions;
}): () => void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    const window = resolveWindow(event);
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('操作栏窗口已关闭');
    const owner = { sender: window.webContents, mainFrame: window.webContents.mainFrame };
    if (!trustedRecorderSender(event, owner) && !trustedOverlaySender(event, owner, 'toolbar')) {
      throw new Error('操作栏呈现请求来源不受信任');
    }
    if (args.length !== 1) throw new Error('操作栏呈现参数无效');
    setRegions(window, parseToolbarRegions(args[0], window.getContentBounds()), { inputOnly: true });
  });
  return () => ipcMain.removeHandler(channel);
}
