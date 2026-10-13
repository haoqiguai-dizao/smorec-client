import { app, BrowserWindow, dialog, screen, type Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CameraPreviewMessage, LiveRecordingState, RecordingControlAction } from '../../shared/types';
import { diagnostic } from './diagnostics';
import { adjustBoundsForReadback, cameraOverlayBounds, cameraOverlayCenter, cameraSettingsReserve, clampOverlayBounds, presenterCameraBounds, toolbarOverlayBounds,
  TOOLBAR_COLLAPSED_HEIGHT, TOOLBAR_EXPANDED_HEIGHT, type CameraCenter } from './recording-overlay/geometry';
import { parseOverlayControl, parsePreviewSignal, trustedOverlaySender, type OverlayRole } from './recording-overlay/validation';
import { APP_NAME } from '../../shared/brand';
import { applicationIcon } from './app-icon';
import { userPreferences } from './user-preferences';
import { collapsedBarAnchor, remapBarAnchor, resizeFromAnchor } from './floating-window-anchor';
import { CameraSettingsWindow } from './recording-overlay/camera-settings-window';
import { captureWindowHandle } from './platform/capture-runtime';
import { setWindowInputRegions } from './platform/window-regions';
import { installRecordingOverlayIpc } from './recording-overlay/ipc';
import { trustedRecorderSender } from './recorder-launcher/validation';
import { setFloatingWindow } from './platform/system-permission-focus';
import { prepareIndependentCamera, protectIndependentCamera } from './demo/camera-policy';

interface OverlayWindow {
  window: BrowserWindow; ready: boolean; loading: boolean; loadGeneration: number;
  recoveryUsed: boolean; failureShown: boolean;
}
export interface RecordingHudOptions {
  toolbarWindow?: () => BrowserWindow | undefined;
  onStop: () => void | Promise<void>;
  onAction: (action: RecordingControlAction) => void | Promise<void>;
  onPreviewRequest: (sessionId: string) => void | Promise<void>;
  onPreviewSignal: (message: CameraPreviewMessage) => void | Promise<void>;
  onCameraPlacement: (center: CameraCenter) => void;
  onCameraSettingsChanged?: (open: boolean) => void;
  onWindowHandlesChanged?: (handles: { toolbar?: string; camera?: string }) => void;
  onCameraState?: (state: LiveRecordingState, bounds?: Rectangle) => void;
  onAuxiliaryPreview?: (message: CameraPreviewMessage) => boolean;
}
const initial: LiveRecordingState = { status: 'idle', cameraAvailable: false, cameraVisible: true, cameraShape: 'circle',
  cameraSize: .22, cameraMirror: true, microphoneEnabled: false, microphoneMuted: false, microphoneName: '',
  systemAudioEnabled: false, systemAudioMuted: false };
const sameBounds = (a: Rectangle | undefined, b: Rectangle): boolean => !!a && (['x', 'y', 'width', 'height'] as const).every(key => a[key] === b[key]);

/** Two isolated, locally visible overlays. Their HWNDs are available for capture-side exclusion. */
export class RecordingHud {
  private presentationHidden = false;
  private cameraCovered = false;
  setCameraCovered(value: boolean) { if (this.cameraCovered !== value) { this.cameraCovered = value; this.paint(); } }
  private livePresentation = false;
  private reportedCameraSettings = false;
  setPresentationHidden(hidden: boolean): void { this.presentationHidden = hidden; this.paint(); }
  setLivePresentation(live: boolean): void { this.livePresentation = live; this.paint(); }
  getToolbarWindow(): BrowserWindow | undefined { return this.callbacks.toolbarWindow?.() ?? this.windows.toolbar?.window; }
  private windows: Partial<Record<OverlayRole, OverlayWindow>> = {};
  private latest = initial;
  private previewSession?: string;
  private pendingSignals: CameraPreviewMessage[] = [];
  private pendingSignalBytes = 0;
  private captureBounds?: Rectangle;
  private cameraCenter: CameraCenter = { x: .85, y: .8 };
  private cameraArea?: Rectangle;
  private presenterArea?: Rectangle;
  private presenterCenter: CameraCenter = { x: .5, y: .5 };
  private overlayRestore?: { bounds: Rectangle; request: Rectangle; viewport?: LiveRecordingState['cameraViewport']; size: number; shape: LiveRecordingState['cameraShape'] };
  private cameraViewport?: LiveRecordingState['cameraViewport'];
  private cameraProgrammaticBounds?: Rectangle;
  private cameraRequestedBounds?: Rectangle;
  private positioningCamera = false;
  private toolbarExpanded = false;
  private toolbarAnchor?: Rectangle;
  private recordingGeneration = 0;
  private disposed = false;
  private removeIpc: () => void;
  private displayListeners = false;
  private cameraSettings = new CameraSettingsWindow({
    bounds: () => this.windows.camera?.window.getBounds(), request: () => this.cameraRequestedBounds,
    setBounds: (request, target) => this.setCameraBounds(request, target), area: bounds => this.area(bounds),
    reserve: bounds => {
      if (this.latest.cameraMode === 'presenter') return bounds;
      return cameraSettingsReserve(bounds, this.area(bounds), this.cameraCenter, this.latest.cameraShape);
    },
    layoutKey: () => `${this.latest.cameraMode}:${this.latest.cameraShape}`,
    setRegions: regions => setWindowInputRegions(this.windows.camera?.window, regions),
  });
  constructor(private callbacks: RecordingHudOptions) {
    this.removeIpc = installRecordingOverlayIpc({ disposed: () => this.disposed, role: event => this.role(event),
      snapshot: () => this.snapshot(), control: value => this.control(value), expanded: value => this.setExpanded(value),
      cameraSettings: value => this.setCameraSettings(value), previewReady: role => {
      this.requireCamera(role);
      if (!this.cameraActive()) throw new Error('当前没有摄像头预览');
      this.revokePreview();
      const sessionId = randomUUID(); this.previewSession = sessionId;
      // Return the lease before host WebRTC setup sends its first offer.
      setImmediate(() => {
        if (this.previewSession === sessionId) void Promise.resolve().then(() => this.callbacks.onPreviewRequest(sessionId))
          .catch(error => diagnostic('overlay.preview-request', error));
      });
      return { sessionId };
    }, previewSignal: (role, value) => {
      this.requireCamera(role);
      const message = parsePreviewSignal(value, this.previewSession ?? '', 'camera');
      return this.callbacks.onPreviewSignal(message);
    } });
    if (app.isReady()) this.watchDisplays(); else app.once('ready', this.watchDisplays);
  }
  private active(): boolean { return ['starting', 'recording', 'stopping'].includes(this.latest.status); }
  private snapshot(): LiveRecordingState { return { ...this.latest, cameraStreaming: this.livePresentation,
    cameraPanel: this.cameraSettings.layout, cameraViewport: this.cameraViewport }; }
  setCameraSettings(open: boolean): void {
    if (this.disposed) throw new Error('摄像头浮窗已经关闭');
    if (open) {
      if (!this.cameraActive() || !this.latest.cameraVisible || this.latest.countdown !== undefined
        || ['starting', 'stopping'].includes(this.latest.status)) throw new Error('请在摄像头就绪后调整画面');
      this.cameraSettings.open();
    } else this.cameraSettings.close();
    this.paint();
  }
  private cameraActive(): boolean { return this.latest.cameraAvailable && (this.active() || !!this.latest.cameraPreviewing); }
  private needed(role: OverlayRole): boolean { return role === 'camera' ? this.cameraActive() : this.active(); }
  private requireCamera(role: OverlayRole): void { if (role !== 'camera') throw new Error('只有摄像头浮窗可以请求预览'); }
  private role(event: Electron.IpcMainInvokeEvent): OverlayRole {
    const toolbar = this.callbacks.toolbarWindow?.();
    if (toolbar && !toolbar.isDestroyed() && trustedRecorderSender(event,
      { sender: toolbar.webContents, mainFrame: toolbar.webContents.mainFrame })) return 'toolbar';
    for (const role of ['toolbar', 'camera'] as const) {
      const window = this.windows[role]?.window;
      if (window && !window.isDestroyed() && trustedOverlaySender(event,
        { sender: window.webContents, mainFrame: window.webContents.mainFrame }, role)) return role;
    }
    throw new Error('浮窗请求来源不受信任');
  }
  private async control(value: unknown): Promise<void> {
    const action = parseOverlayControl(value);
    const previewControl = this.latest.cameraPreviewing && this.cameraActive() && action.type.startsWith('camera-');
    if ((!this.active() && !previewControl) || this.latest.status === 'stopping') throw new Error('当前无法操作录制');
    if (action.type === 'stop') { await this.callbacks.onStop(); return; }
    if (action.type.startsWith('camera-') && !this.latest.cameraAvailable) throw new Error('摄像头未开启');
    if (action.type === 'microphone-muted' && !this.latest.microphoneEnabled) throw new Error('麦克风未开启');
    if (action.type === 'system-muted' && !this.latest.systemAudioEnabled) throw new Error('系统声音未开启');
    await this.callbacks.onAction(action);
  }
  update(state: LiveRecordingState): void {
    if (this.disposed) return;
    const beginning = state.status === 'starting' && !this.active();
    const previewBeginning = state.cameraPreviewing && (!this.latest.cameraPreviewing || state.cameraSessionId !== this.latest.cameraSessionId);
    const sourceChanged = state.cameraSessionId !== this.latest.cameraSessionId;
    const cameraRestored = state.cameraVisible && !this.latest.cameraVisible;
    const modeChanged = (state.cameraMode ?? 'overlay') !== (this.latest.cameraMode ?? 'overlay');
    if (sourceChanged || modeChanged || !state.cameraAvailable || !state.cameraVisible || state.countdown !== undefined
      || ['starting', 'stopping'].includes(state.status) || state.status === 'recording' && this.latest.status !== 'recording'
      || !state.cameraPreviewing && state.status !== 'recording') this.cameraSettings.close();
    const resize = state.cameraSize !== this.latest.cameraSize || state.cameraShape !== this.latest.cameraShape
      || state.cameraPresenter?.aspect !== this.latest.cameraPresenter?.aspect;
    const cameraWindow = this.windows.camera?.window;
    if (modeChanged && state.cameraMode === 'presenter' && cameraWindow && !cameraWindow.isDestroyed()) {
      const bounds = cameraWindow.getBounds();
      this.cameraArea = this.area(bounds);
      const request = this.cameraRequestedBounds && this.cameraProgrammaticBounds
        ? adjustBoundsForReadback(this.cameraRequestedBounds, this.cameraProgrammaticBounds, bounds) : bounds;
      this.overlayRestore = { bounds, request, viewport: this.cameraViewport, size: this.latest.cameraSize, shape: this.latest.cameraShape };
      this.presenterArea = this.cameraArea; this.presenterCenter = { x: .5, y: .5 };
    }
    if (previewBeginning || beginning && !this.latest.cameraPreviewing) {
      const saved = userPreferences.read().camera; this.cameraCenter = { x: saved.x, y: saved.y };
      this.overlayRestore = undefined;
    }
    if (previewBeginning) this.captureBounds = undefined;
    if (beginning) { this.toolbarExpanded = false; ++this.recordingGeneration; }
    this.latest = { ...state, warnings: state.warnings ? [...state.warnings] : undefined };
    if (!this.cameraActive() || sourceChanged) this.revokePreview();
    if (this.active() && !this.callbacks.toolbarWindow) {
      this.ensure('toolbar', beginning);
    } else this.setExpanded(false);
    if (this.cameraActive()) this.ensure('camera', beginning || !!previewBeginning || cameraRestored);
    if (beginning || previewBeginning) this.positionInCaptureArea(); else if (resize || modeChanged) this.resizeCamera();
    this.paint();
  }
  signalFromHost(value: CameraPreviewMessage): void {
    if (this.callbacks.onAuxiliaryPreview?.(value)) return;
    const message = parsePreviewSignal(value, this.previewSession ?? '', 'host');
    const camera = this.windows.camera;
    if (!camera || camera.window.isDestroyed()) throw new Error('摄像头浮窗尚未就绪');
    if (!camera.ready) {
      const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (this.pendingSignals.length >= 32 || this.pendingSignalBytes + bytes > 256 * 1024) throw new Error('摄像头预览信令等待队列已满');
      this.pendingSignals.push(message); this.pendingSignalBytes += bytes; return;
    }
    camera.window.webContents.send('recording-overlay:preview-incoming', message);
  }
  /** Electron DIP bounds, not physical capture pixels. */
  setCaptureBounds(bounds?: Rectangle): void {
    this.captureBounds = bounds;
    this.positionInCaptureArea();
  }
  getWindowHandles(): { toolbar?: string; camera?: string } {
    const result: { toolbar?: string; camera?: string } = {};
    for (const role of ['toolbar', 'camera'] as const) {
      const window = role === 'toolbar' ? this.getToolbarWindow() : this.windows.camera?.window;
      if (!window || window.isDestroyed()) continue;
      const handle = window.getNativeWindowHandle();
      result[role] = captureWindowHandle(handle, process.platform);
    }
    return result;
  }
  private area(bounds?: Rectangle): Rectangle {
    return bounds ? screen.getDisplayMatching(bounds).workArea : this.captureBounds
      ? screen.getDisplayMatching(this.captureBounds).workArea : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  }
  private ensure(role: OverlayRole, retry = false): void {
    const existing = this.windows[role];
    if (existing) {
      if (retry) {
        existing.recoveryUsed = false; existing.failureShown = false;
        if (!existing.ready && !existing.loading) this.load(role, existing);
      }
      return;
    }
    const area = role === 'camera' && this.cameraArea ? this.area(this.cameraArea) : this.area();
    if (role === 'camera') this.cameraArea = area;
    const bounds = role === 'camera' ? this.latest.cameraMode === 'presenter' ? presenterCameraBounds(area, undefined, this.latest.cameraPresenter?.aspect)
      : cameraOverlayBounds(area, this.latest.cameraSize, this.cameraCenter, this.latest.cameraShape)
      : toolbarOverlayBounds(area, this.toolbarExpanded);
    if (role === 'camera') this.cameraViewport = { width: bounds.width, height: bounds.height };
    const window = new BrowserWindow({ ...bounds, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      // Overlay CSS owns the shadow; macOS must not add another native halo.
      hasShadow: process.platform !== 'darwin',
      roundedCorners: process.platform !== 'darwin' || role === 'camera',
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
      title: role === 'camera' ? `${APP_NAME}摄像头` : `${APP_NAME}录制控制`, icon: applicationIcon(),
      webPreferences: { preload: path.join(app.getAppPath(), 'dist-electron', 'overlay-preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } });
    if (role === 'camera') protectIndependentCamera(window);
    // Keep recording controls and camera above the whiteboard even when it receives focus.
    if (process.platform === 'darwin') setFloatingWindow(window, role === 'camera' ? 1 : 2);
    const entry: OverlayWindow = { window, ready: false, loading: false, loadGeneration: 0, recoveryUsed: false, failureShown: false };
    this.windows[role] = entry;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
      if (!isMainFrame || this.windows[role]?.window !== window) return;
      this.windows[role]!.ready = false;
      if (role === 'camera') this.revokePreview();
    });
    window.webContents.on('did-finish-load', () => {
      const generation = entry.loadGeneration;
      void (role === 'camera' ? prepareIndependentCamera(window) : Promise.resolve()).then(() => {
        if (this.disposed || this.windows[role]?.window !== window || window.isDestroyed() || generation !== entry.loadGeneration) return;
        entry.loading = false; entry.ready = true; this.paint();
        if (role === 'camera') {
          for (const message of this.pendingSignals) {
            if (message.sessionId === this.previewSession) window.webContents.send('recording-overlay:preview-incoming', message);
          }
          this.pendingSignals = []; this.pendingSignalBytes = 0;
        }
      }).catch(error => { diagnostic('overlay.' + role + '.capture-policy', error); this.failed(role, entry); });
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      diagnostic('overlay.' + role + '.gone', details.reason);
      this.failed(role, entry);
    });
    window.on('move', () => this.moved(role));
    if (role === 'toolbar') window.on('will-move', (event, proposed) => {
      const area = this.area(proposed), bounds = clampOverlayBounds(proposed, area);
      this.toolbarAnchor = collapsedBarAnchor(bounds, TOOLBAR_COLLAPSED_HEIGHT);
      // Programmatic layout never changes the saved monitor or drag anchor.
      userPreferences.update({ toolbarBounds: this.toolbarAnchor, toolbarArea: area });
      if (proposed.x !== bounds.x || proposed.y !== bounds.y) { event.preventDefault(); window.setBounds(bounds); }
    });
    window.on('close', event => { if (!this.disposed) event.preventDefault(); });
    window.on('closed', () => {
      if (this.windows[role]?.window === window) delete this.windows[role];
      if (role === 'camera') this.revokePreview();
      if (!this.disposed) this.callbacks.onWindowHandlesChanged?.(this.getWindowHandles());
    });
    this.load(role, entry);
    this.callbacks.onWindowHandlesChanged?.(this.getWindowHandles());
  }
  private load(role: OverlayRole, entry: OverlayWindow): void {
    if (this.disposed || this.windows[role] !== entry || entry.window.isDestroyed()) return;
    const generation = ++entry.loadGeneration;
    entry.ready = false; entry.loading = true;
    // Reload the same native window: capture exclusion was fixed to its HWND at start.
    void entry.window.loadURL('frameflow://app/index.html?overlay=' + role).catch(error => {
      if (this.disposed || entry.loadGeneration !== generation) return;
      diagnostic('overlay.' + role + '.load', error); this.failed(role, entry);
    });
  }
  private failed(role: OverlayRole, entry: OverlayWindow): void {
    if (this.disposed || this.windows[role] !== entry || entry.window.isDestroyed()) return;
    ++entry.loadGeneration; entry.ready = false; entry.loading = false; entry.window.hide();
    if (role === 'camera') { this.cameraSettings.close(); this.revokePreview(); }
    if (!this.needed(role)) return;
    if (!entry.recoveryUsed) {
      entry.recoveryUsed = true;
      setImmediate(() => { if (this.needed(role) && !entry.ready && !entry.loading) this.load(role, entry); });
      return;
    }
    if (entry.failureShown || this.latest.status === 'stopping') return;
    entry.failureShown = true;
    if (!this.active()) {
      void dialog.showMessageBox({ type: 'error', title: `${APP_NAME}摄像头预览`, message: '摄像头浮窗暂时无法显示',
        detail: '请在录制栏关闭摄像头后重新开启。', buttons: ['知道了'] }).catch(error => diagnostic('overlay.camera.recovery', error));
      return;
    }
    const recordingGeneration = this.recordingGeneration;
    void dialog.showMessageBox({ type: 'error', title: `${APP_NAME}录制浮窗异常`,
      message: role === 'toolbar' ? '录制操作条暂时无法显示' : '摄像头浮窗暂时无法显示',
      detail: `录制仍在继续。可以停止并保存，也可通过托盘或 ${process.platform === 'darwin' ? '⌘+⇧+R' : 'Ctrl+Shift+R'} 停止。`,
      buttons: ['停止并保存', '继续录制'], defaultId: 0, cancelId: 1, noLink: true,
    }).then(result => {
      if (result.response === 0 && !this.disposed && this.active() && recordingGeneration === this.recordingGeneration) return this.callbacks.onStop();
    }).catch(error => diagnostic('overlay.' + role + '.recovery', error));
  }
  private paint(): void {
    const camera = this.windows.camera?.window;
    this.callbacks.onCameraState?.(this.snapshot(), camera && !camera.isDestroyed() ? camera.getBounds() : undefined);
    const toolbar = this.callbacks.toolbarWindow?.();
    if (toolbar && !toolbar.isDestroyed() && !toolbar.webContents.isDestroyed())
      toolbar.webContents.send('recording-overlay:state', this.snapshot());
    const settingsOpen = !!this.cameraSettings.layout;
    if (settingsOpen !== this.reportedCameraSettings) {
      this.reportedCameraSettings = settingsOpen;
      this.callbacks.onCameraSettingsChanged?.(settingsOpen);
    }
    for (const role of ['toolbar', 'camera'] as const) {
      const entry = this.windows[role];
      if (!entry || !entry.ready || entry.window.isDestroyed()) continue;
      entry.window.webContents.send('recording-overlay:state', this.snapshot());
      const visible = !this.presentationHidden && this.needed(role) && (role === 'toolbar' || this.latest.cameraVisible && !this.cameraCovered);
      if (visible) { if (!entry.window.isVisible()) entry.window.showInactive(); }
      else entry.window.hide();
    }
  }
  private moved(role: OverlayRole): void {
    if (role === 'camera' && this.positioningCamera) return;
    const window = this.windows[role]?.window;
    if (!window || window.isDestroyed()) return;
    const observed = window.getBounds();
    if (role === 'camera' && sameBounds(this.cameraProgrammaticBounds, observed)) return;
    const current = role === 'camera' ? this.cameraSettings.moved(observed) : observed;
    const area = this.area(current), bounds = clampOverlayBounds(current, area);
    if (role === 'camera' && this.latest.cameraMode === 'presenter') {
      if (sameBounds(this.cameraProgrammaticBounds, current)) return;
      const fitted = presenterCameraBounds(area, cameraOverlayCenter(current, area), this.latest.cameraPresenter?.aspect);
      this.presenterArea = area; this.presenterCenter = cameraOverlayCenter(fitted, area);
      if (!sameBounds(current, fitted)) {
        this.cameraViewport = { width: fitted.width, height: fitted.height }; this.cameraSettings.resize(fitted);
      }
      this.paint();
      return;
    }
    if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
      if (role === 'camera') {
        if (current.width !== bounds.width || current.height !== bounds.height) this.cameraViewport = { width: bounds.width, height: bounds.height };
        this.cameraSettings.resize(bounds);
      } else window.setBounds(bounds);
      return;
    }
    if (role === 'camera') {
      if (sameBounds(this.cameraProgrammaticBounds, current)) return;
      this.cameraArea = area; this.overlayRestore = undefined;
      const center = cameraOverlayCenter(bounds, area);
      if (Math.abs(center.x - this.cameraCenter.x) + Math.abs(center.y - this.cameraCenter.y) < .001) return;
      this.cameraCenter = center; this.callbacks.onCameraPlacement(center);
      this.paint();
    }
  }
  private resizeCamera(): void {
    const window = this.windows.camera?.window;
    if (!window || window.isDestroyed()) return;
    let bounds: Rectangle, restoreTarget: Rectangle | undefined, viewport: LiveRecordingState['cameraViewport'];
    if (this.latest.cameraMode === 'presenter') {
      const area = this.area(this.presenterArea ?? this.cameraArea ?? window.getBounds());
      this.presenterArea = area; bounds = presenterCameraBounds(area, this.presenterCenter, this.latest.cameraPresenter?.aspect);
    } else {
      const area = this.area(this.cameraArea ?? window.getBounds()); this.cameraArea = area;
      const saved = this.overlayRestore;
      if (saved && saved.size === this.latest.cameraSize && saved.shape === this.latest.cameraShape) {
        restoreTarget = clampOverlayBounds(saved.bounds, area);
        bounds = adjustBoundsForReadback(saved.request, saved.bounds, restoreTarget);
        viewport = saved.viewport;
      } else bounds = cameraOverlayBounds(area, this.latest.cameraSize, this.cameraCenter, this.latest.cameraShape);
    }
    this.cameraViewport = viewport ?? { width: bounds.width, height: bounds.height };
    this.cameraSettings.resize(bounds, restoreTarget);
  }
  private setCameraBounds(request: Rectangle, restoreTarget?: Rectangle): void {
    const window = this.windows.camera?.window;
    if (!window || window.isDestroyed()) return;
    this.positioningCamera = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        window.setBounds(request);
        this.cameraRequestedBounds = { ...request };
        this.cameraProgrammaticBounds = window.getBounds();
        if (!restoreTarget || sameBounds(this.cameraProgrammaticBounds, restoreTarget)) break;
        request = adjustBoundsForReadback(request, this.cameraProgrammaticBounds, restoreTarget);
      }
    } finally { this.positioningCamera = false; }
  }
  private positionInCaptureArea(): void {
    if (!app.isReady()) return;
    const area = this.area(), toolbar = this.windows.toolbar?.window, camera = this.windows.camera?.window;
    if (toolbar && !toolbar.isDestroyed()) {
      const { toolbarBounds: saved, toolbarArea: savedArea } = userPreferences.read();
      const legacyOnTarget = saved && saved.x < area.x + area.width && saved.x + saved.width > area.x
        && saved.y < area.y + area.height && saved.y + saved.height > area.y;
      this.toolbarAnchor = saved && savedArea ? remapBarAnchor(collapsedBarAnchor(saved, TOOLBAR_COLLAPSED_HEIGHT), savedArea, area)
        : legacyOnTarget ? collapsedBarAnchor(saved, TOOLBAR_COLLAPSED_HEIGHT) : toolbarOverlayBounds(area, false);
      toolbar.setBounds(resizeFromAnchor(this.toolbarAnchor, area, this.toolbarExpanded ? TOOLBAR_EXPANDED_HEIGHT : TOOLBAR_COLLAPSED_HEIGHT));
    }
    if (camera && !camera.isDestroyed()) {
      // Capture selection positions the toolbar; the camera keeps its own monitor and mode geometry.
      this.resizeCamera();
    }
  }
  private revokePreview(): void {
    const sessionId = this.previewSession;
    this.previewSession = undefined; this.pendingSignals = []; this.pendingSignalBytes = 0;
    if (sessionId) void Promise.resolve().then(() => this.callbacks.onPreviewSignal({ sessionId, signal: { type: 'close' } }))
      .catch(error => diagnostic('overlay.preview-close', error));
  }
  private setExpanded(expanded: boolean): void {
    if (this.toolbarExpanded === expanded) return;
    this.toolbarExpanded = expanded;
    const window = this.windows.toolbar?.window;
    if (!window || window.isDestroyed()) return;
    const anchor = this.toolbarAnchor ?? collapsedBarAnchor(window.getBounds(), TOOLBAR_COLLAPSED_HEIGHT);
    window.setBounds(resizeFromAnchor(anchor, this.area(anchor), expanded ? TOOLBAR_EXPANDED_HEIGHT : TOOLBAR_COLLAPSED_HEIGHT));
  }
  private layout = (): void => {
    for (const role of ['toolbar', 'camera'] as const) this.moved(role);
    this.resizeCamera();
  };
  private watchDisplays = (): void => {
    if (this.disposed) return;
    this.displayListeners = true;
    screen.on('display-removed', this.layout); screen.on('display-metrics-changed', this.layout);
  };
  dispose(): void {
    this.disposed = true; this.revokePreview();
    app.removeListener('ready', this.watchDisplays);
    if (this.displayListeners) { screen.removeListener('display-removed', this.layout); screen.removeListener('display-metrics-changed', this.layout); }
    this.removeIpc();
    for (const entry of Object.values(this.windows)) entry?.window.destroy();
    this.windows = {};
  }
}
