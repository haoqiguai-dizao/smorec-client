import { BrowserWindow } from 'electron';
import path from 'node:path';
import { APP_NAME } from '../../shared/brand';
import { applicationIcon } from './app-icon';
import { userPreferences } from './user-preferences';
import { diagnostic } from './diagnostics';

interface Options {
  rendererUrl?: string; preloadDirectory: string;
  quitting(): boolean; allowClose(): boolean; recording(): boolean;
  created(window: BrowserWindow): void; ready(value: boolean): void; closed(): void; wake(): void; stop(): void;
  error(title: string, message: string): void;
}
export async function createEditorWindow(options: Options): Promise<BrowserWindow> {
  let loaded = false;
  const editor = new BrowserWindow({ width: 1440, height: 920, ...userPreferences.read().editorBounds, minWidth: 1040, minHeight: 700, show: false,
    frame: false, backgroundColor: '#111216', title: APP_NAME, icon: applicationIcon(),
    webPreferences: { preload: path.join(options.preloadDirectory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false,
      sandbox: true, webSecurity: true, backgroundThrottling: false } });
  editor.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  editor.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) options.ready(false); });
  editor.webContents.on('will-navigate', (event, url) => {
    const expected = options.rendererUrl ? new URL(options.rendererUrl).origin : 'frameflow://app';
    if (!(url === expected || url.startsWith(`${expected}/`))) event.preventDefault();
  });
  editor.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    diagnostic('renderer.load-failed', description, { code });
    if (loaded) options.error(`${APP_NAME}界面加载失败`, `${description}（${code}），请重新打开应用。`);
  });
  editor.on('close', event => {
    if (options.allowClose()) return;
    event.preventDefault(); if (!options.quitting()) options.wake();
  });
  const rememberBounds = (_event: Electron.Event, bounds: Electron.Rectangle) => {
    if (!options.quitting() && !editor.isDestroyed() && editor.isVisible() && !editor.isMinimized() && !editor.isMaximized()) {
      userPreferences.update({ editorBounds: bounds });
    }
  };
  const rememberMaximized = () => {
    if (!options.quitting() && !editor.isDestroyed() && editor.isVisible() && !editor.isMinimized()) {
      userPreferences.update({ editorMaximized: editor.isMaximized() });
    }
  };
  editor.on('will-move', rememberBounds); editor.on('will-resize', rememberBounds);
  editor.on('maximize', rememberMaximized); editor.on('unmaximize', rememberMaximized);
  editor.on('closed', () => { options.ready(false); options.closed(); });
  editor.webContents.on('render-process-gone', (_event, details) => {
    options.ready(false); diagnostic('renderer.gone', details.reason);
    if (options.recording()) options.stop();
    if (!options.quitting() && !options.allowClose()) options.error(`${APP_NAME}界面已停止`, '界面进程意外退出，请重新打开应用。已录制的原始素材会保留。');
  });
  options.created(editor);
  try {
    await editor.loadURL(options.rendererUrl ?? 'frameflow://app/index.html'); loaded = true; return editor;
  } catch (error) { editor.destroy(); throw error; }
}
