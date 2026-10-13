import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { MAC_PERMISSIONS } from '../../../shared/platform-permissions';
import { applicationIcon } from '../app-icon';
import type { NativeClient } from '../native-client';
import { readPlatformPermissions } from './permission-status';

const URL = 'frameflow://app/index.html?overlay=permission-startup';
type Sender = IpcMainEvent | IpcMainInvokeEvent;
/** The production workspace is not constructed until all five permissions have been read back. */
export class PermissionStartupWindow {
  private window?: BrowserWindow;
  private pending?: Promise<boolean>;
  private finish?: (ready: boolean) => void;
  constructor(private native: NativeClient, private quit: () => Promise<void>, private loaded?: () => Promise<void>) {
    ipcMain.handle('permission-startup:enter', async (event, ...args: unknown[]) => {
      this.check(event, args);
      const status = await readPlatformPermissions(native);
      if (!MAC_PERMISSIONS.every(kind => status.some(item => item.kind === kind && item.granted))) throw new Error('授权还未全部生效，请完成后再进入');
      this.finish?.(true); this.destroy();
    });
    ipcMain.handle('permission-startup:quit', (event, ...args: unknown[]) => { this.check(event, args); return this.quit(); });
    app.on('before-quit', () => { this.finish?.(false); this.destroy(); });
  }
  isTrusted(event: Sender) {
    return !!this.window && !this.window.isDestroyed() && event.sender === this.window.webContents
      && event.senderFrame === this.window.webContents.mainFrame && event.senderFrame?.url === URL;
  }
  private check(event: Sender, args: unknown[]) {
    if (!this.isTrusted(event) || args.length) throw new Error('启动授权请求来源或参数无效');
  }
  async ensure(): Promise<boolean> {
    if (process.platform !== 'darwin') return true;
    if (this.pending) { this.window?.show(); this.window?.focus(); return this.pending; }
    const pending = this.showIfNeeded(); this.pending = pending;
    try { return await pending; } finally { if (this.pending === pending) this.pending = undefined; }
  }
  private async showIfNeeded(): Promise<boolean> {
    let readable = true;
    const status = await readPlatformPermissions(this.native).catch(() => { readable = false; return []; });
    if (MAC_PERMISSIONS.every(kind => status.some(item => item.kind === kind && item.granted))) return true;
    const ready = new Promise<boolean>(resolve => { this.finish = resolve; });
    const window = new BrowserWindow({ width: 680, height: 660, minWidth: 620, minHeight: 630,
      show: false, resizable: false, maximizable: false, fullscreenable: false, title: '小录 · 首次使用',
      backgroundColor: '#171a20', icon: applicationIcon(),
      webPreferences: { preload: path.join(app.getAppPath(), 'dist-electron/permission-window-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    this.window = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => { if (this.window === window) { event.preventDefault(); void this.quit(); } });
    try {
      await window.loadURL(URL);
      if (!window.isDestroyed()) {
        window.show(); window.focus();
        // A usable permission page is a successful app startup. Waiting for the
        // human to grant access must not roll an otherwise healthy update back.
        if (readable) await this.loaded?.();
      }
    }
    catch (error) { this.finish?.(false); this.destroy(); throw error; }
    return ready;
  }
  private destroy() {
    const window = this.window; this.window = undefined; window?.destroy();
    this.finish = undefined;
  }
}
