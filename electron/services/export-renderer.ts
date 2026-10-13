import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import type { Project } from '../../shared/types';
import type { ExportRenderProgress } from '../../shared/export-render';
import type { Exporter } from './exporter';
import type { ProjectStore } from './projects';

interface RenderSession {
  window: BrowserWindow; owner: BrowserWindow; project: Project; url: string;
  resolve: (path: string | null) => void; reject: (error: Error) => void;
  settling: boolean; canceled: boolean; startup?: ReturnType<typeof setTimeout>; deadline?: ReturnType<typeof setTimeout>;
}

/** One isolated compositor plus the encoder/muxer pipeline. No per-segment process fan-out. */
export class ExportRenderer {
  private active?: RenderSession;
  constructor(private exporter: Exporter, private projects: ProjectStore, private rendererUrl?: string) {
    const handle = (name: string, action: (session: RenderSession, ...args: unknown[]) => unknown) => {
      ipcMain.handle(`export-renderer:${name}`, (event, ...args) => action(this.trusted(event), ...args));
    };
    handle('ready', session => { clearTimeout(session.startup); return session.project; });
    handle('status', () => ({ platform: process.platform, version: app.getVersion(), nativeAvailable: false, ffmpegAvailable: true }));
    handle('start', (session, settings) => {
      if (session.canceled) throw new Error('导出已取消');
      return exporter.start(session.owner, session.project, settings);
    });
    handle('cancel-preparation', () => exporter.cancelPreparation());
    handle('append', (_session, id, data) => exporter.append(id, data));
    handle('finish', (_session, id) => exporter.finish(id));
    handle('cancel', (_session, id) => exporter.cancel(id));
    ipcMain.on('export-renderer:progress', (event, value: unknown) => {
      if (!this.isTrusted(event) || !value || typeof value !== 'object') return;
      const next = value as ExportRenderProgress;
      if (!Number.isFinite(next.progress) || next.progress < 0 || next.progress > 1
        || typeof next.phase !== 'string' || next.phase.length > 120) return;
      const owner = this.active!.owner;
      if (!owner.isDestroyed()) owner.webContents.send('studio:export-render-progress', next);
    });
    ipcMain.on('export-renderer:complete', (event, value: unknown) => {
      if (!this.isTrusted(event) || !value || typeof value !== 'object') return;
      const result = value as { path?: unknown; error?: unknown }, session = this.active!;
      if (typeof result.error === 'string') void this.settle(session, null, new Error(result.error.slice(0, 2000)));
      else if (result.path === null && !exporter.isActive() || exporter.isCompleted(result.path))
        void this.settle(session, result.path as string | null);
      else void this.settle(session, null, new Error('导出进程未返回已完成的视频'));
    });
  }
  isActive(): boolean { return !!this.active; }
  private isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const session = this.active;
    return !!session && !session.settling && !session.window.isDestroyed()
      && event.sender === session.window.webContents && event.senderFrame === event.sender.mainFrame
      && event.senderFrame.url === session.url;
  }
  private trusted(event: IpcMainEvent | IpcMainInvokeEvent): RenderSession {
    if (!this.isTrusted(event)) throw new Error('导出请求来源不受信任');
    return this.active!;
  }
  async start(owner: BrowserWindow, value: unknown): Promise<string | null> {
    if (this.active || this.exporter.isActive()) throw new Error('已有视频正在导出');
    const project = this.projects.view(this.projects.edited(value));
    const url = new URL(this.rendererUrl ?? 'frameflow://app/index.html'); url.searchParams.set('overlay', 'export');
    const window = new BrowserWindow({ show: false, width: 64, height: 64, skipTaskbar: true,
      webPreferences: { preload: path.join(app.getAppPath(), 'dist-electron', 'export-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const completion = new Promise<string | null>((resolve, reject) => {
      this.active = { window, owner, project, url: url.href, resolve, reject, settling: false, canceled: false };
    });
    const session = this.active!;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.once('render-process-gone', () => { void this.settle(session, null, new Error('导出进程中断，原始工程已保留')); });
    window.once('closed', () => { void this.settle(session, null, new Error('导出进程已关闭')); });
    const ownerClosed = () => { this.cancel(); };
    owner.once('closed', ownerClosed);
    session.startup = setTimeout(() => { void this.settle(session, null, new Error('导出进程启动超时')); }, 15000);
    void window.loadURL(session.url).catch(error => this.settle(session, null, error));
    try { return await completion; }
    finally { owner.removeListener('closed', ownerClosed); }
  }
  cancel(): void {
    const session = this.active;
    if (!session || session.settling || session.canceled) return;
    session.canceled = true; this.exporter.cancelPreparation();
    if (!session.window.isDestroyed()) session.window.webContents.send('export-renderer:abort');
    session.deadline = setTimeout(() => { void this.settle(session, null, new Error('导出已取消')); }, 2000);
  }
  private async settle(session: RenderSession, result: string | null, error?: Error): Promise<void> {
    if (this.active !== session || session.settling) return;
    session.settling = true; clearTimeout(session.startup); clearTimeout(session.deadline);
    try { await this.exporter.dispose(); }
    catch (cause) { error ??= cause instanceof Error ? cause : new Error(String(cause)); }
    finally {
      if (!session.window.isDestroyed()) session.window.destroy();
      if (this.active === session) this.active = undefined;
      if (session.canceled || error) session.reject(error ?? new Error('导出已取消'));
      else session.resolve(result);
    }
  }
  async dispose(): Promise<void> {
    if (this.active) await this.settle(this.active, null, new Error('导出已取消'));
  }
}
