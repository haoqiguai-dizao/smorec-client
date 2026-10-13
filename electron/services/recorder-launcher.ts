import { app, BrowserWindow, ipcMain, screen, type Rectangle } from 'electron';
import path from 'node:path';
import type { AppStatus, CameraCommand, CameraEffects, CameraPreviewMessage, CaptureSource, MicrophoneDevice, RecordingState } from '../../shared/types';
import { diagnostic } from './diagnostics';
import { PanelDrag } from './recorder-launcher/panel-drag';
import { revealWindow } from './window-visibility';
import { clampLauncherBounds, launcherBounds, LAUNCHER_WIDTH, LAUNCHER_COLLAPSED_HEIGHT, LAUNCHER_EXPANDED_HEIGHT } from './recorder-launcher/geometry';
import { collapsedBarAnchor, resizeFromAnchor } from './floating-window-anchor';
import { RECORDER_URL, trustedRecorderSender } from './recorder-launcher/validation';
import { APP_NAME } from '../../shared/brand';
import { applicationIcon } from './app-icon';
import { userPreferences } from './user-preferences';
import { setFloatingWindow } from './platform/system-permission-focus';

type MaybePromise<T> = T | Promise<T>;
export interface RecorderLauncherOptions {
  getStatus: () => MaybePromise<AppStatus>;
  getSources: () => MaybePromise<CaptureSource[]>;
  getMicrophones: () => MaybePromise<MicrophoneDevice[]>;
  onStart: (options: unknown) => Promise<void>;
  onSetExcludedApplications?: (applications: unknown) => Promise<void>;
  onOpenEditor: () => MaybePromise<void>;
  onOpenCameraSettings: () => MaybePromise<void>;
  onQuit: () => MaybePromise<void>;
  onCameraPrepare: () => Promise<{ id: string }>;
  onCameraAttach?: (id: unknown) => Promise<void>;
  onCameraStarted: (id: unknown, timestamp: unknown, mimeType?: unknown) => MaybePromise<void>;
  onCameraAppend: (id: unknown, data: unknown) => Promise<void>;
  onCameraFinish: (id: unknown) => Promise<void>;
  onCameraCancel: (id: unknown) => Promise<void>;
  onCameraFrameStall: (id: unknown, stalledSeconds: unknown) => MaybePromise<void>;
  onCameraFrameResumed: (id: unknown) => MaybePromise<void>;
  onCameraPreviewSignal: (message: unknown) => MaybePromise<void>;
  onCameraPreviewQuality: (id: unknown, detail: unknown) => MaybePromise<void>;
  onCameraPreviewReady: (id: unknown, effects: unknown) => MaybePromise<void>;
  onCameraPreviewClosed: (id: unknown) => MaybePromise<void>;
  onCameraPreviewCountdown: (id: unknown, value: unknown) => MaybePromise<void>;
  /** Install camera permissions before any launcher document is loaded. */
  onCreated?: (window: BrowserWindow) => void;
  /** Also runs when the hidden camera-owning renderer fails during recording. */
  onFailure?: (error: Error) => void;
}
interface LauncherWindow {
  window: BrowserWindow;
  ready: Promise<void>;
  rejectReady: (error: Error) => void;
  rendererSubscribed: boolean;
  failed: boolean;
}

/** Recorder-only IPC and an independent native window; editor privileges are never exposed. */
export class RecorderLauncher {
  private panelDrag = new PanelDrag(() => screen.getCursorScreenPoint(), bounds => {
    this.collapsedAnchor = collapsedBarAnchor(bounds, LAUNCHER_COLLAPSED_HEIGHT);
    userPreferences.update({ launcherBounds: this.collapsedAnchor });
  }, bounds => {
    const area = screen.getDisplayMatching(bounds).workArea;
    return { width: Math.min(LAUNCHER_WIDTH, area.width), height: Math.min(this.expanded ? LAUNCHER_EXPANDED_HEIGHT : LAUNCHER_COLLAPSED_HEIGHT, area.height) };
  });
  private entry?: LauncherWindow;
  private disposed = false;
  private expanded = false;
  private collapsedAnchor?: Rectangle;
  private wantedVisible = false;
  private activationPending = false;
  private latest: RecordingState = { status: 'idle' };
  private channels: string[] = [];
  private displayListeners = false;

  constructor(private callbacks: RecorderLauncherOptions) {
    this.handle('status', 0, () => callbacks.getStatus());
    this.handle('sources', 0, () => callbacks.getSources());
    this.handle('microphones', 0, () => callbacks.getMicrophones());
    this.handle('record-start', 1, options => callbacks.onStart(options));
    this.handle('record-exclusions', 1, applications => {
      if (!callbacks.onSetExcludedApplications) throw new Error('当前版本不支持录制中调整排除应用');
      return callbacks.onSetExcludedApplications(applications);
    });
    this.handle('open-editor', 0, () => callbacks.onOpenEditor());
    this.handle('open-camera-settings', 0, () => callbacks.onOpenCameraSettings());
    this.handle('quit', 0, () => callbacks.onQuit());
    this.handle('expanded', 1, value => {
      if (typeof value !== 'boolean') throw new Error('录制设置面板状态无效');
      this.setExpanded(value);
    });
    this.handle('camera-prepare', 0, () => callbacks.onCameraPrepare());
    this.handle('camera-attach', 1, id => {
      if (!callbacks.onCameraAttach) throw new Error('当前录制栏不支持途中开启摄像头');
      return callbacks.onCameraAttach(id);
    });
    this.handle('drag-window', 1, action => this.panelDrag.handle(action, this.getWindow()));
    this.handle('camera-started', [2, 3], (id, timestamp, mimeType) => callbacks.onCameraStarted(id, timestamp, mimeType));
    this.handle('camera-append', 2, (id, data) => callbacks.onCameraAppend(id, data));
    this.handle('camera-finish', 1, id => callbacks.onCameraFinish(id));
    this.handle('camera-cancel', 1, id => callbacks.onCameraCancel(id));
    this.handle('camera-frame-stall', 2, (id, stalledSeconds) => callbacks.onCameraFrameStall(id, stalledSeconds));
    this.handle('camera-frame-resumed', 1, id => callbacks.onCameraFrameResumed(id));
    this.handle('camera-preview-signal', 1, message => callbacks.onCameraPreviewSignal(message));
    this.handle('camera-preview-quality', 2, (id, detail) => callbacks.onCameraPreviewQuality(id, detail));
    this.handle('camera-preview-ready', 2, (id, effects) => callbacks.onCameraPreviewReady(id, effects));
    this.handle('camera-preview-closed', 1, id => callbacks.onCameraPreviewClosed(id));
    this.handle('camera-preview-countdown', 2, (id, value) => callbacks.onCameraPreviewCountdown(id, value));
    ipcMain.on('recorder:ready', this.rendererReady);
    if (app.isReady()) this.watchDisplays(); else app.once('ready', this.watchDisplays);
  }

  isTrusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    const window = this.getWindow();
    return Boolean(window && !window.webContents.isDestroyed() && trustedRecorderSender(event,
      { sender: window.webContents, mainFrame: window.webContents.mainFrame }));
  }

  private handle(name: string, count: number | number[], callback: (...args: unknown[]) => unknown): void {
    const channel = 'recorder:' + name;
    this.channels.push(channel);
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (this.disposed || !this.isTrusted(event)) throw new Error('录制启动器请求来源不受信任');
      if (!(Array.isArray(count) ? count.includes(args.length) : args.length === count)) throw new Error('录制启动器请求参数无效');
      try { return await callback(...args); }
      catch (error) { diagnostic('ipc.' + channel, error); throw error; }
    });
  }

  getWindow(): BrowserWindow | undefined {
    const window = this.entry?.window;
    return window && !window.isDestroyed() ? window : undefined;
  }

  isVisible(): boolean { return this.getWindow()?.isVisible() ?? false; }

  showControls(): void {
    const window = this.getWindow();
    if (!window) return;
    this.wantedVisible = true;
    revealWindow(window, screen.getAllDisplays().map(display => display.workArea));
  }

  async show(): Promise<void> {
    if (this.disposed) throw new Error('录制启动器已经关闭');
    if (!app.isReady()) await app.whenReady();
    if (this.disposed) return;
    this.wantedVisible = true;
    this.activationPending = true;
    if (this.entry?.failed) {
      const previous = this.entry;
      this.entry = undefined;
      if (!previous.window.isDestroyed()) previous.window.destroy();
    }
    const entry = this.entry ?? this.create();
    await entry.ready;
    if (this.disposed || this.entry !== entry || !this.wantedVisible || entry.failed) return;
    const primary = screen.getPrimaryDisplay();
    const displays = [primary, ...screen.getAllDisplays().filter(display => display.id !== primary.id)];
    revealWindow(entry.window, displays.map(display => display.workArea));
    this.activate();
  }

  hide(): void {
    this.panelDrag.handle('end');
    this.wantedVisible = false;
    this.activationPending = false;
    this.getWindow()?.hide();
    this.setExpanded(false);
  }

  setExpanded(expanded: boolean): void {
    if (this.expanded === expanded) return;
    this.expanded = expanded;
    const window = this.getWindow();
    if (!window) return;
    const anchor = this.collapsedAnchor ?? collapsedBarAnchor(window.getBounds(), LAUNCHER_COLLAPSED_HEIGHT);
    window.setBounds(resizeFromAnchor(anchor, screen.getDisplayMatching(anchor).workArea,
      expanded ? LAUNCHER_EXPANDED_HEIGHT : LAUNCHER_COLLAPSED_HEIGHT));
  }

  publishRecordingState(state: RecordingState): void {
    this.latest = { ...state, warnings: state.warnings ? [...state.warnings] : undefined };
    this.send('record-state', this.latest);
  }
  cameraCommand(command: CameraCommand): void { this.send('camera-command', command); }
  previewRequest(sessionId: string): void { this.send('camera-preview-request', sessionId); }
  previewSignal(message: CameraPreviewMessage): void { this.send('camera-preview-signal', message); }
  cameraEnabled(enabled: boolean): void { this.send('camera-enabled', enabled); }
  cameraEffects(effects: CameraEffects): void { this.send('camera-effects', effects); }

  private send(channel: string, value: unknown): void {
    const entry = this.entry;
    if (!entry || entry.failed || !entry.rendererSubscribed || entry.window.isDestroyed() || entry.window.webContents.isDestroyed()) return;
    entry.window.webContents.send('recorder:' + channel, value);
  }

  private rendererReady = (event: Electron.IpcMainEvent): void => {
    if (this.disposed || !this.isTrusted(event) || !this.entry) return;
    this.entry.rendererSubscribed = true;
    this.send('record-state', this.latest);
    this.activate();
  };

  private activate(): void {
    if (!this.activationPending || !this.wantedVisible || !this.isVisible() || !this.entry?.rendererSubscribed) return;
    this.activationPending = false;
    this.send('activate', undefined);
  }

  private create(): LauncherWindow {
    const saved = userPreferences.read().launcherBounds;
    const area = (saved ? screen.getDisplayMatching(saved) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea;
    const initial = launcherBounds(area);
    this.collapsedAnchor = saved ? { ...initial, x: saved.x, y: saved.y + saved.height - initial.height } : initial;
    const restored = resizeFromAnchor(this.collapsedAnchor, area, this.expanded ? LAUNCHER_EXPANDED_HEIGHT : LAUNCHER_COLLAPSED_HEIGHT);
    const window = new BrowserWindow({ ...restored, show: false,
      frame: false, transparent: true, backgroundColor: '#00000000', title: `${APP_NAME}录制`, icon: applicationIcon(),
      // The toolbar CSS owns its shadow; macOS otherwise adds a second native halo.
      hasShadow: process.platform !== 'darwin',
      // Remove AppKit's outer frame around the transparent CSS gutter.
      roundedCorners: process.platform !== 'darwin',
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true,
      webPreferences: { preload: path.join(app.getAppPath(), 'dist-electron', 'recorder-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
    if (process.platform === 'darwin') setFloatingWindow(window, 2);
    let resolveReady!: () => void, rejectReady!: (error: Error) => void;
    let painted = false, loaded = false;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => {});
    const entry: LauncherWindow = { window, ready, rejectReady, rendererSubscribed: false, failed: false };
    this.entry = entry;
    const timer = setTimeout(() => this.failed(entry, new Error('录制操作栏在 30 秒内未能完成加载')), 30_000);
    void ready.then(() => clearTimeout(timer), () => clearTimeout(timer));
    const complete = () => { if (painted && loaded && !entry.failed) resolveReady(); };
    window.once('ready-to-show', () => { painted = true; complete(); });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (isMainFrame) entry.rendererSubscribed = false;
    });
    window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) this.failed(entry, new Error(`录制操作栏加载失败：${description}（${code}）`));
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      this.failed(entry, new Error(`录制操作栏进程意外退出：${details.reason}`));
    });
    window.on('move', this.keepOnScreen);
    // Electron emits will-move only for a manual move, never setBounds/restore.
    window.on('will-move', (event, proposed) => {
      const area = screen.getDisplayMatching(proposed).workArea;
      const bounds = clampLauncherBounds(proposed, area);
      this.collapsedAnchor = collapsedBarAnchor(bounds, LAUNCHER_COLLAPSED_HEIGHT);
      userPreferences.update({ launcherBounds: this.collapsedAnchor });
      if (proposed.x !== bounds.x || proposed.y !== bounds.y) { event.preventDefault(); window.setBounds(bounds); }
    });
    window.on('close', event => {
      if (this.disposed) return;
      event.preventDefault();
      void Promise.resolve().then(() => this.callbacks.onQuit()).catch(error => diagnostic('recorder.quit', error));
    });
    window.on('closed', () => {
      entry.rejectReady(new Error('录制操作栏已关闭'));
      if (this.entry === entry) this.entry = undefined;
    });
    try { this.callbacks.onCreated?.(window); }
    catch (error) {
      this.failed(entry, error instanceof Error ? error : new Error(String(error)));
      return entry;
    }
    void window.loadURL(RECORDER_URL).then(() => { loaded = true; complete(); })
      .catch(error => this.failed(entry, error instanceof Error ? error : new Error(String(error))));
    return entry;
  }

  private failed(entry: LauncherWindow, error: Error): void {
    if (this.disposed || this.entry !== entry || entry.failed) return;
    entry.failed = true;
    entry.rendererSubscribed = false;
    entry.rejectReady(error);
    if (!entry.window.isDestroyed()) entry.window.hide();
    diagnostic('recorder.renderer-failed', error);
    try { this.callbacks.onFailure?.(error); }
    catch (failure) { diagnostic('recorder.failure-handler', failure); }
  }

  private keepOnScreen = (): void => {
    const window = this.getWindow();
    if (!window) return;
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const clamped = clampLauncherBounds(bounds, area);
    if (bounds.x !== clamped.x || bounds.y !== clamped.y || bounds.width !== clamped.width || bounds.height !== clamped.height) window.setBounds(clamped);
  };

  private watchDisplays = (): void => {
    if (this.disposed) return;
    this.displayListeners = true;
    screen.on('display-removed', this.keepOnScreen);
    screen.on('display-metrics-changed', this.keepOnScreen);
  };

  dispose(): void {
    this.panelDrag.handle('end');
    if (this.disposed) return;
    this.disposed = true;
    this.wantedVisible = false;
    this.activationPending = false;
    app.removeListener('ready', this.watchDisplays);
    if (this.displayListeners) {
      screen.removeListener('display-removed', this.keepOnScreen);
      screen.removeListener('display-metrics-changed', this.keepOnScreen);
    }
    for (const channel of this.channels) ipcMain.removeHandler(channel);
    ipcMain.removeListener('recorder:ready', this.rendererReady);
    this.getWindow()?.destroy();
    this.entry = undefined;
  }
}
