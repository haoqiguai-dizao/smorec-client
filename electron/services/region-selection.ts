import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'node:path';
import type { CaptureSource, Rect } from '../../shared/types';
import { validRegion, type RegionSelectionConfiguration } from '../../shared/region-selection';
interface Options {
  trusted(event: Electron.IpcMainInvokeEvent): boolean; sources(): Promise<CaptureSource[]>; idle(): boolean;
  hide(owner: BrowserWindow | undefined): void; restore(owner: BrowserWindow | undefined): void; rendererUrl?: string;
}
export function installRegionSelection(options: Options): void {
  let picker: BrowserWindow | undefined, configuration: RegionSelectionConfiguration | undefined;
  let owner: BrowserWindow | undefined;
  let pending = false, finish: ((crop: Rect | null) => void) | undefined;
  const close = (crop: Rect | null) => {
    const resolve = finish, window = picker, previous = owner; finish = undefined; picker = undefined; configuration = undefined; owner = undefined;
    if (window && !window.isDestroyed()) window.destroy();
    options.restore(previous); resolve?.(crop);
  };
  const trustedPicker = (event: Electron.IpcMainInvokeEvent) => picker && !picker.isDestroyed()
    && event.sender === picker.webContents && event.senderFrame === picker.webContents.mainFrame;
  ipcMain.handle('region:select', async (event, ...args: unknown[]) => {
    if (!options.trusted(event) || args.length !== 2 || typeof args[0] !== 'string' || args[0].length > 4096) throw new Error('框选请求无效');
    if (!options.idle() || pending) throw new Error('请先结束当前采集再框选区域');
    pending = true;
    try {
      const source = (await options.sources()).find(item => item.id === args[0] && item.kind === 'screen');
      if (!source?.bounds || !options.idle()) throw new Error('屏幕已断开，请重新选择');
      const bounds = process.platform === 'win32' ? screen.screenToDipRect(null, source.bounds) : source.bounds;
      const display = process.platform === 'darwin' ? screen.getAllDisplays().find(item => `screen:${item.id}` === source.id) : screen.getDisplayMatching(bounds);
      if (!display) throw new Error('屏幕已断开，请重新选择');
      configuration = { source: { ...source, thumbnail: undefined }, ...(validRegion(args[1], source.width, source.height) ? { initial: args[1] } : {}) };
      owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      picker = new BrowserWindow({ ...display.bounds, frame: false, transparent: true, resizable: false,
        fullscreen: process.platform !== 'darwin', simpleFullscreen: process.platform === 'darwin',
        skipTaskbar: true, show: false, hasShadow: false, backgroundColor: '#00000000',
        webPreferences: { preload: path.join(__dirname, 'region-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      const window = picker;
      if (process.platform === 'darwin') window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      window.setAlwaysOnTop(true, 'screen-saver'); window.setContentProtection(true);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.on('closed', () => { if (picker === window) close(null); });
      window.webContents.on('render-process-gone', () => { if (picker === window) close(null); });
      const result = new Promise<Rect | null>(resolve => { finish = resolve; }); options.hide(owner);
      try {
        await window.loadURL(options.rendererUrl ? `${options.rendererUrl}?overlay=region` : 'frameflow://app/index.html?overlay=region');
        if (picker === window) { window.show(); window.focus(); }
      } catch (error) { close(null); throw error; }
      return await result;
    } finally { pending = false; }
  });
  ipcMain.handle('region:configuration', event => { if (!trustedPicker(event) || !configuration) throw new Error('框选窗口已关闭'); return configuration; });
  ipcMain.handle('region:complete', (event, ...args: unknown[]) => {
    if (!trustedPicker(event) || args.length !== 1 || !configuration || !validRegion(args[0], configuration.source.width, configuration.source.height)) throw new Error('请拖出至少 32 × 32 的区域');
    close(args[0]);
  });
  ipcMain.handle('region:cancel', event => { if (!trustedPicker(event)) throw new Error('框选窗口已关闭'); close(null); });
  const displayChanged = () => { if (picker) close(null); };
  screen.on('display-removed', displayChanged);
  screen.on('display-metrics-changed', (_event, _display, metrics) => {
    if (metrics.some(value => ['bounds', 'scaleFactor', 'rotation'].includes(value))) displayChanged();
  });
}
