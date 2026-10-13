import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent, type Rectangle, type WebContents } from 'electron';
import path from 'node:path';
import { MAC_PERMISSIONS, type MacPermission } from '../../../shared/platform-permissions';
import type { PermissionGuideAction, PermissionGuideContext } from '../../../shared/permission-guide';
import type { NativeClient } from '../native-client';
import { permissionGuideBounds } from './permission-guide-geometry';
import { showPermissionGuideHelp } from './permission-guide-help';
import { setFloatingWindow } from './system-permission-focus';
import { diagnostic } from '../diagnostics';

type Sender = IpcMainEvent | IpcMainInvokeEvent;
const URL = 'frameflow://app/index.html?overlay=permissions';
const actions: PermissionGuideAction[] = ['close', 'complete', 'skip-input', 'enable-input', 'disable-camera', 'disable-microphone'];
interface Options { trusted(event: Sender): boolean; busy(): boolean; native: NativeClient }
interface SettingsWindow { bounds?: Rectangle; foreground?: boolean; failed?: boolean }

/** A single owned companion. It neither automates System Settings nor starts capture. */
export class PermissionGuideWindow {
  private window?: BrowserWindow;
  private owner?: WebContents;
  private value?: PermissionGuideContext;
  private ownerDestroyed?: () => void;
  private loading?: Promise<void>;
  private watching?: ReturnType<typeof setInterval>;
  private positioning = false;
  private revision = 0;
  constructor(private options: Options) {
    ipcMain.handle('permission-guide:show', async (event, ...args: unknown[]) => {
      this.checkOwner(event, args, 1);
      const value = args[0] as PermissionGuideContext;
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['kind', 'needs', 'mode', 'inputDisabled', 'startup', 'component'].includes(key))
        || !MAC_PERMISSIONS.includes(value.kind) || !Array.isArray(value.needs) || value.needs.length > 5
        || value.needs.some(kind => !MAC_PERMISSIONS.includes(kind)) || !['record', 'live'].includes(value.mode)
        || typeof value.inputDisabled !== 'boolean' || value.startup !== undefined && typeof value.startup !== 'boolean'
        || value.component !== undefined && (!value.startup || !['screen', 'input', 'accessibility'].includes(value.kind)
          || !['application', 'capture'].includes(value.component) || value.kind !== 'screen' && value.component !== 'capture')) throw new Error('授权引导参数无效');
      this.owner = event.sender; this.value = structuredClone(value);
      await this.show();
    });
    ipcMain.handle('permission-guide:dismiss', (event, ...args: unknown[]) => {
      if (!this.options.trusted(event) || args.length) throw new Error('授权引导来源无效');
      this.dismiss();
    });
    ipcMain.handle('permission-guide:context', (event, ...args: unknown[]) => {
      this.checkChild(event, args, 0); return this.value ?? null;
    });
    ipcMain.handle('permission-guide:action', (event, ...args: unknown[]) => {
      this.checkChild(event, args, 1);
      if (!actions.includes(args[0] as PermissionGuideAction)) throw new Error('授权引导操作无效');
      this.choose(args[0] as PermissionGuideAction);
    });
    ipcMain.handle('permission-guide:step', (event, ...args: unknown[]) => {
      this.checkChild(event, args, 1);
      const kind = args[0] as MacPermission;
      if (!MAC_PERMISSIONS.includes(kind) || !this.value || !this.value.needs.includes(kind)) throw new Error('授权步骤无效');
      if (this.options.busy()) { this.dismiss(); return; }
      this.value.kind = kind;
    });
    ipcMain.handle('permission-guide:help', (event, ...args: unknown[]) => {
      this.checkChild(event, args, 0);
      if (this.options.busy()) { this.dismiss(); return; }
      if (this.window && this.value) showPermissionGuideHelp(this.window, this.value, this.options.busy,
        action => this.window?.webContents.send('permission-guide:help-action', action), action => this.choose(action));
    });
    app.on('before-quit', () => this.dismiss());
  }
  isTrusted(event: Sender): boolean {
    const contents = this.window?.webContents;
    return !!contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame === contents.mainFrame
      && event.senderFrame?.url === URL;
  }
  private checkChild(event: Sender, args: unknown[], count: number) {
    if (!this.isTrusted(event) || args.length !== count) throw new Error('授权引导来源或参数无效');
  }
  private checkOwner(event: Sender, args: unknown[], count: number) {
    if (!this.options.trusted(event) || args.length !== count || process.platform !== 'darwin') throw new Error('授权引导来源或参数无效');
    if (this.options.busy()) throw new Error('请先结束录制、投屏或导出，再调整系统权限');
  }
  private notify(action: PermissionGuideAction) {
    if (this.owner && !this.owner.isDestroyed()) this.owner.send('permission-guide:owner-action', action);
  }
  private choose(action: PermissionGuideAction) {
    if (this.options.busy()) { this.dismiss(); return; }
    this.notify(action); this.dismiss();
  }
  dismiss() {
    this.revision++;
    clearInterval(this.watching); this.watching = undefined;
    if (this.ownerDestroyed) this.owner?.removeListener('destroyed', this.ownerDestroyed);
    this.ownerDestroyed = undefined;
    const window = this.window; this.window = undefined; this.loading = undefined;
    window?.destroy(); this.value = undefined; this.owner = undefined;
  }
  private async show() {
    const revision = this.revision;
    let window = this.window;
    if (!window) {
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      window = new BrowserWindow({ ...permissionGuideBounds(area), show: false, frame: false, title: '小录授权引导',
        transparent: true, backgroundColor: '#00000000', hasShadow: false, roundedCorners: false,
        resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
        skipTaskbar: true, alwaysOnTop: true,
        webPreferences: { preload: path.join(app.getAppPath(), 'dist-electron', 'permission-window-preload.cjs'),
          sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
      this.window = window;
      setFloatingWindow(window, 3);
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.on('page-title-updated', event => event.preventDefault());
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.webContents.on('will-attach-webview', event => event.preventDefault());
      const owned = window;
      window.on('closed', () => { if (this.window === owned) { this.notify('close'); this.dismiss(); } });
      this.ownerDestroyed = () => { if (this.window === owned) this.dismiss(); };
      this.owner?.once('destroyed', this.ownerDestroyed);
      this.loading = window.loadURL(URL);
    }
    try { await this.loading; }
    catch (error) { if (this.window === window) this.dismiss(); throw error; }
    if (revision !== this.revision || this.window !== window || this.options.busy()) return;
    window.webContents.send('permission-guide:context-changed', this.value);
    if (this.value?.startup) await this.positionBySettings();
    else if (this.value?.inputDisabled) { window.show(); window.focus(); }
    else window.showInactive();
  }
  async positionBySettings() {
    if (!this.window || this.positioning) return;
    clearInterval(this.watching);
    await this.position(!this.value?.startup);
    if (!this.window) return;
    this.watching = setInterval(() => { void this.position(false); }, 1500);
    this.watching.unref();
  }
  private async position(retry: boolean) {
    if (this.positioning) return;
    this.positioning = true;
    const revision = this.revision, window = this.window;
    try {
      for (let attempt = 0; window && attempt < (retry ? 5 : 1); attempt++) {
        if (revision !== this.revision || window.isDestroyed()) return;
        if (this.options.busy()) { this.dismiss(); return; }
        const result = await this.options.native.request<SettingsWindow>('permission-settings-window').catch(() => ({ failed: true } as SettingsWindow));
        if (revision !== this.revision || window.isDestroyed()) return;
        if (this.options.busy()) { this.dismiss(); return; }
        if (result.failed) { if (this.value?.startup) window.hide(); return; }
        const bounds = result.bounds;
        if (bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key as keyof Rectangle])) && bounds.width > 0 && bounds.height > 0) {
          const next = permissionGuideBounds(screen.getDisplayMatching(bounds).workArea, bounds), current = window.getBounds();
          if (['x', 'y', 'width', 'height'].some(key => current[key as keyof Rectangle] !== next[key as keyof Rectangle])) {
            window.setBounds(next);
            diagnostic('permission-guide.position', undefined, { settings: bounds, guide: next });
          }
          if (result.foreground === false && window.isVisible()) window.hide();
          else if (result.foreground !== false && !window.isVisible()) window.showInactive();
          return;
        }
        if (this.value?.startup) window.hide();
        if (!retry) {
          if (!this.value?.startup) { this.notify('close'); this.dismiss(); }
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } finally { this.positioning = false; }
  }
}
