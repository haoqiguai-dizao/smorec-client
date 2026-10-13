import { app, BrowserWindow, globalShortcut, ipcMain, screen, type Rectangle } from 'electron';
import path from 'node:path';
import type { CaptureSource, RecordingOptions, RecordingState, LiveRecordingState, CameraPreviewMessage } from '../../../shared/types';
import type { BoardMode, BoardPresentation, BoardSnapshot } from '../../../shared/whiteboard/types';
import { parseBoardAction } from '../../../shared/whiteboard/validation';
import { trustedOverlaySender } from '../recording-overlay/validation';
import { trustedRecorderSender } from '../recorder-launcher/validation';
import { captureWindowHandle } from '../platform/capture-runtime';
import { diagnostic } from '../diagnostics';
import { boardBounds, boardWindowBounds, boardControlInsets, clampBoard, recordingArea, usableBoardArea } from './geometry';
import type { WhiteboardJournal } from './journal';
import { SpeechSession } from './speech-session';
import { WhiteboardPresentation } from './presentation';
import { applyBoardWindowOptions, defaultBoardWindowOptions, parseBoardWindowOptions } from './window-options';
import { applyBoardCapturePolicy } from './capture-policy';
import { installWhiteboardImageIpc } from './image-ipc';
import { BoardCameraPreview, type BoardCameraPorts } from './camera-preview';
import { BoardCameraMode } from './camera-mode';
import { chooseBoardMode } from './mode-selection';
import { BoardVisibilityGate } from './visibility-gate';

export class WhiteboardWindow {
  private window?: BrowserWindow;
  private area?: Rectangle;
  private usableArea?: Rectangle;
  private available = true;
  private status: RecordingState['status'] = 'idle';
  private previewing = false;
  private resumeVisible = false;
  private previewPreparation?: Promise<void>;
  private preparingWindow = Promise.resolve();
  private owner: 'record' | 'live' = 'record';
  private visible = false;
  private positioning = false;
  private maximized = false;
  private restoreBounds?: Rectangle;
  private disposed = false;
  private error?: string;
  private channels: string[] = [];
  private windowOptions = defaultBoardWindowOptions();
  private shortcutRegistered = false;
  private interfaceTransparencySupported = process.platform === 'darwin';
  private demoVisible = false;
  private camera: BoardCameraPreview;
  private cameraMode: BoardCameraMode;
  private visibilityGate = new BoardVisibilityGate();
  private choosingMode = false;
  constructor(private journal: WhiteboardJournal, private toolbar: () => BrowserWindow | undefined, private closing: () => boolean = () => false,
    private speech = new SpeechSession(), private presentation = new WhiteboardPresentation(), cameraPorts?: BoardCameraPorts) {
    this.camera = new BoardCameraPreview(() => this.window, cameraPorts);
    this.cameraMode = new BoardCameraMode(() => ({
      window: this.window, area: this.area, usableArea: this.usableArea, session: this.journal.session,
      available: this.available, visible: this.visible, disposed: this.disposed, presentation: this.presentation.mode,
      setBounds: bounds => { this.positioning = true; try { this.window?.setBounds(bounds); } finally { this.positioning = false; } },
      setPresentation: value => { this.presentation.mode = value; },
      sync: (value, visible) => this.syncPresentation(value, visible),
      append: () => this.journal.append(this.layout(this.visible, this.window!.getBounds())),
      publish: () => this.publish(), failed: error => this.failed(error),
    }), this.camera);
    if (this.speech.model) this.speech.model.onState = () => this.publish();
    this.speech.onLevel = (id, level) => {
      if (this.available && this.visible && this.window && !this.window.isDestroyed())
        this.window.webContents.send('whiteboard:speech-level', { session: this.journal.session, id, level });
    };
    this.handle('snapshot', () => ({ ...this.state(), events: this.journal.events }));
    this.handle('view-ready', (event, session, opening) => {
      if (event.sender === this.window?.webContents && session === this.journal.session) this.visibilityGate.ready(opening);
    });
    this.handle('mode', async event => {
      if (this.choosingMode || !this.available || this.cameraMode.busy || this.presentation.busy) return;
      const parent = event.sender === this.window?.webContents ? this.window : this.toolbar();
      if (!parent) return;
      this.choosingMode = true;
      const session = this.journal.session;
      try {
        const current = this.cameraMode.backdrop === 'camera' ? 'camera' : this.presentation.mode;
        const mode = await chooseBoardMode(parent, current, this.camera.available(), this.presentation.supported);
        if (mode && !this.disposed && this.available && session === this.journal.session) await this.openMode(mode);
      } finally { this.choosingMode = false; }
    });
    this.handle('visible', async (_event, value) => {
      if (typeof value !== 'boolean') throw new Error('白板显示参数无效');
      await this.setVisible(value);
    });
    this.handle('presentation', async (event) => {
      if (event.sender !== this.toolbar()?.webContents || !this.available || this.presentation.busy || this.cameraMode.busy || this.cameraMode.backdrop === 'camera') return;
      this.presentation.busy = true; this.publish();
      try {
        await this.ensurePreview();
        const session = this.journal.session;
        const mode = await this.presentation.choose(this.toolbar()!, { options: this.windowOptions,
          transparencySupported: this.presentation.mode !== 'interface' || this.interfaceTransparencySupported,
          change: value => { void this.configureWindow(session, value).catch(error => this.failed(error)); } });
        if (!mode || !this.available || session !== this.journal.session || !this.window) return;
        await this.configurePresentation(mode);
      } finally { this.presentation.busy = false; this.publish(); }
    });
    this.handle('window-options', async (_event, session, value) => {
      await this.configureWindow(session, value);
    });
    this.handle('backdrop', async (event, session, value, shade) => {
      if (event.sender !== this.window?.webContents || session !== this.journal.session || !this.visible || !this.available)
        throw new Error('白板会话已失效');
      await this.cameraMode.configure(value, shade);
    });
    for (const name of ['camera-ready', 'camera-signal']) this.handle(name, (event, value) => {
      if (event.sender !== this.window?.webContents || !this.visible && name === 'camera-ready') throw new Error('白板摄像头会话已失效');
      return name === 'camera-ready' ? this.camera.ready() : this.camera.signal(value, this.visible);
    });
    this.handle('action', async (event, session, value) => {
      if (event.sender !== this.window?.webContents || session !== this.journal.session) throw new Error('白板会话已失效');
      if (!this.available || !this.visible || this.cameraMode.busy) throw new Error('白板当前不可书写');
      try {
        const action = parseBoardAction(value);
        const image = action.kind === 'image' ? action : action.kind === 'replace' && action.element.kind === 'image' ? action.element : undefined;
        if (image) await this.journal.assetFile(session, image.asset);
        if (session !== this.journal.session || !this.visible) throw new Error('白板会话已失效');
        await this.journal.append(action);
      }
      catch (error) { if (session === this.journal.session) this.failed(error); throw error; }
    });
    installWhiteboardImageIpc({ handle: (name, callback) => this.handle(name, callback), journal,
      check: (event, session) => {
        if (event.sender !== this.window?.webContents || session !== this.journal.session
          || !this.available || !this.visible || this.cameraMode.busy) throw new Error('白板会话已失效');
      } });
    this.handle('maximized', async (event, session, value) => {
      if (event.sender !== this.window?.webContents || session !== this.journal.session
        || !this.available || !this.visible || typeof value !== 'boolean' || !this.window || !this.area)
        throw new Error('白板会话已失效');
      if (value === this.maximized) return;
      if (this.cameraMode.busy || this.cameraMode.backdrop === 'camera') throw new Error('摄像头白板已铺满录制区域');
      if (value) this.restoreBounds = this.window.getBounds();
      this.maximized = value;
      const target = value ? this.usableArea! : this.restoreBounds ?? this.window.getBounds();
      this.positioning = true;
      this.window.setBounds(clampBoard(target, this.usableArea!));
      this.positioning = false;
      try { await this.journal.append(this.layout(true, this.window.getBounds())); }
      finally { this.publish(); }
    });
    const verifySpeech = (event: Electron.IpcMainInvokeEvent, session: unknown) => {
      if (event.sender !== this.window?.webContents || session !== this.journal.session
        || !this.available || !this.visible || this.cameraMode.busy) throw new Error('白板语音会话已失效');
    };
    this.handle('speech-ready', (event, session) => {
      verifySpeech(event, session); return this.speech.ready();
    });
    this.handle('speech-install', (event, session) => {
      verifySpeech(event, session); return this.speech.install();
    });
    this.handle('speech-start', (event, session) => {
      verifySpeech(event, session); return this.speech.start();
    });
    this.handle('speech-stop', (event, session, id) => {
      verifySpeech(event, session);
      if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('语音片段无效');
      return this.speech.stop(id);
    });
    this.handle('speech-cancel', (event, session) => {
      verifySpeech(event, session); return this.speech.cancel();
    });

  }
  private handle(name: string, callback: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
    const channel = `whiteboard:${name}`; this.channels.push(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const toolbar = this.toolbar();
      const fromToolbar = toolbar && !toolbar.isDestroyed() && (
        trustedRecorderSender(event, { sender: toolbar.webContents, mainFrame: toolbar.webContents.mainFrame })
        || trustedOverlaySender(event, { sender: toolbar.webContents, mainFrame: toolbar.webContents.mainFrame }, 'toolbar'));
      const fromBoard = this.window && !this.window.isDestroyed() && trustedOverlaySender(event,
        { sender: this.window.webContents, mainFrame: this.window.webContents.mainFrame }, 'whiteboard');
      if (this.disposed || !fromToolbar && !fromBoard) {
        throw new Error('白板请求来源不受信任');
      }
      return callback(event, ...args);
    });
  }
  private state(): Omit<BoardSnapshot, 'events'> {
    const bounds = this.window?.getBounds();
    return { session: this.journal.session, available: this.available, visible: this.visible, maximized: this.maximized,
      controlsInsets: bounds && boardControlInsets(bounds, screen.getDisplayMatching(bounds).workArea), opening: this.visibilityGate.token,
      backdrop: this.cameraMode.backdrop, shade: this.cameraMode.shade, sceneBusy: this.cameraMode.busy, camera: this.camera.state, cameraTransition: this.cameraMode.transition,
      error: this.error, speechSupported: process.platform === 'darwin' || process.platform === 'win32', presentation: this.presentation.mode,
      windowOptions: { ...this.windowOptions },
      speechModel: this.speech.model?.snapshot(),
      interfaceSupported: this.presentation.supported, presentationBusy: this.presentation.busy,
      interfaceTransparencySupported: this.interfaceTransparencySupported, demoVisible: this.demoVisible };
  }
  private layout(visible: boolean, bounds: Rectangle) {
    return { kind: 'layout' as const, visible, bounds: this.cameraMode.backdrop === 'camera' || this.cameraMode.transition
      ? { x: 0, y: 0, width: 1, height: 1 } : boardBounds(bounds, this.area!, this.maximized),
      windowBounds: boardWindowBounds(bounds, this.area!), presentation: this.presentation.mode,
      ...(this.cameraMode.backdrop === 'camera' || this.cameraMode.transition ? { backdrop: this.cameraMode.backdrop, shade: this.cameraMode.shade,
        ...(this.cameraMode.transition ? { cameraTransition: { direction: this.cameraMode.transition.direction,
          duration: this.cameraMode.transition.duration, camera: this.cameraMode.transition.camera } } : {}) } : {}),
      ...(this.windowOptions.passthrough ? { passthrough: true } : {}) };
  }
  private async configureWindow(session: unknown, value: unknown) {
    if (session !== this.journal.session || !this.available || !this.window) throw new Error('白板会话已失效');
    const next = { ...this.windowOptions, ...parseBoardWindowOptions(value) };
    if (next.transparent && this.presentation.mode === 'interface') this.requireInterfaceTransparency();
    applyBoardWindowOptions(this.window, next);
    applyBoardCapturePolicy(this.window, this.presentation.mode);
    const passChanged = next.passthrough !== this.windowOptions.passthrough;
    this.windowOptions = next;
    if (this.visible && passChanged) await this.journal.append(this.layout(true, this.window.getBounds()));
    this.publish();
    if (this.visible && !next.passthrough) this.window.show();
  }
  private requireInterfaceTransparency(): void {
    if (!this.interfaceTransparencySupported) throw new Error('当前完整界面不支持本地透明，请关闭透明或使用 Mac 录制');
  }
  setDemoVisibility(visible: boolean): void { this.demoVisible = visible; this.publish(); }
  updateCamera(state: LiveRecordingState, bounds?: Rectangle) {
    this.camera.update(state, bounds);
    this.speech.setDevice(state.microphoneDeviceId, this.owner === 'record' && state.status === 'recording' && state.microphoneEnabled);
    this.publish();
  }
  cameraSignal(message: CameraPreviewMessage) { return this.camera.receive(message); }
  private publish(): void {
    for (const window of [this.window, this.toolbar()]) {
      if (window && !window.isDestroyed()) window.webContents.send('whiteboard:state', this.state());
    }
  }
  update(state: RecordingState, owner: 'record' | 'live' = 'record'): void {
    if (owner !== this.owner) return;
    if (state.status === 'starting' && this.previewing) this.resumeVisible ||= this.visible || !!this.previewPreparation;
    this.status = state.status;
    this.available = ['idle', 'error', 'recording'].includes(this.status);
    if (this.status !== 'recording' && !(this.previewing && ['idle', 'error'].includes(this.status))) {
      this.visible = false; this.window?.hide(); void this.speech.shutdown();
      this.cameraMode.cancel();
      this.visibilityGate.cancel();
      this.camera.close(); this.camera.cover(false);
    }
    if (this.status === 'recording' && this.resumeVisible) {
      this.resumeVisible = false;
      void this.setVisible(true, false).catch(error => this.failed(error));
    }
    this.publish();
  }
  preparing(owner: 'record' | 'live'): void {
    this.owner = owner;
    this.update({ status: 'starting' }, owner);
  }
  private async ensurePreview(): Promise<void> {
    if (!['idle', 'error'].includes(this.status) || this.previewing && this.window && !this.window.isDestroyed() && !this.previewPreparation) return;
    if (this.previewPreparation) return this.previewPreparation;
    this.previewing = true;
    const preparing = (async () => {
      await this.journal.startPreview(path.join(app.getPath('userData'), 'whiteboard-draft'), true);
      if (!['idle', 'error'].includes(this.status)) return;
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      await this.prepare({ id: 'whiteboard-preview', kind: 'screen', name: '白板预备',
        width: display.workArea.width, height: display.workArea.height, bounds: display.workArea },
      { sourceId: 'whiteboard-preview', fps: 30, microphone: false, systemAudio: false }, 'record', true);
      if (['idle', 'error'].includes(this.status)) { this.available = true; this.publish(); }
    })();
    this.previewPreparation = preparing;
    try { await preparing; }
    catch (error) { this.previewing = false; this.available = ['idle', 'error'].includes(this.status); this.publish(); throw error; }
    finally { this.previewPreparation = undefined; }
  }
  private syncPresentation(mode: 'canvas' | 'interface', visible: boolean): Promise<void> {
    return this.previewing ? Promise.resolve() : this.presentation.sync(this.window!, mode, visible);
  }
  prepare(source: CaptureSource, options: RecordingOptions, owner: 'record' | 'live' = 'record', preview = false): Promise<string | undefined> {
    const preparing = this.preparingWindow.then(() => this.prepareWindow(source, options, owner, preview));
    this.preparingWindow = preparing.then(() => {}, () => {});
    return preparing;
  }
  private async prepareWindow(source: CaptureSource, options: RecordingOptions, owner: 'record' | 'live', preview: boolean): Promise<string | undefined> {
    const wasPreview = this.previewing;
    const previousBounds = wasPreview && this.window && !this.window.isDestroyed() ? this.window.getBounds() : undefined;
    const mode = this.presentation.mode;
    this.cameraMode.cancel();
    this.owner = owner; this.available = false;
    this.previewing = preview;
    this.interfaceTransparencySupported = process.platform === 'darwin' && owner === 'record';
    this.error = undefined;
    this.presentation.reset();
    if (wasPreview || this.cameraMode.backdrop === 'camera') this.presentation.mode = mode;
    else { this.maximized = false; this.restoreBounds = undefined; }
    if (this.presentation.mode === 'interface' && this.windowOptions.transparent) this.requireInterfaceTransparency();
    this.windowOptions.passthrough = false;
    this.speech.setDevice(options.microphoneDeviceId, options.microphone);
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const sourceBounds = source.bounds ? process.platform === 'win32' ? screen.screenToDipRect(null, source.bounds) : source.bounds : display.workArea;
    this.area = recordingArea(source, options, sourceBounds);
    const area = this.usableArea = usableBoardArea(this.area, screen.getDisplayMatching(this.area).workArea);
    // Very small capture regions cannot host usable controls. Opening reports the reason.
    const bounds = this.cameraMode.backdrop === 'camera' ? this.area : clampBoard(this.maximized ? area : previousBounds ?? { x: area.x + area.width * .13, y: area.y + area.height * .12,
      width: Math.min(960, area.width * .74), height: Math.min(640, area.height * .76) }, area);
    if (!this.window || this.window.isDestroyed()) {
      this.window = new BrowserWindow({ ...bounds, show: false, frame: false, roundedCorners: false, transparent: true, backgroundColor: '#ffffff',
        title: '小录白板', alwaysOnTop: this.windowOptions.pinned, skipTaskbar: true, resizable: true, minimizable: false, maximizable: false,
        fullscreenable: false, hasShadow: true, minWidth: 320, minHeight: 250,
        webPreferences: { preload: path.join(app.getAppPath(), 'dist-electron', 'whiteboard-preload.cjs'),
          sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      applyBoardWindowOptions(this.window, this.windowOptions);
      this.shortcutRegistered = globalShortcut.register('CommandOrControl+Shift+B', () => {
        if (this.available && this.visible) void this.configureWindow(this.journal.session,
          { passthrough: !this.windowOptions.passthrough }).catch(error => this.failed(error));
      });
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.window.webContents.on('will-navigate', event => event.preventDefault());
      this.window.webContents.on('will-attach-webview', event => event.preventDefault());
      this.window.on('close', event => {
        if (this.disposed || this.closing()) return;
        event.preventDefault();
        if (this.available) void this.setVisible(false).catch(error => this.failed(error));
        else this.window?.hide();
      });
      this.window.on('move', () => this.moved()); this.window.on('resize', () => this.moved());
      this.window.webContents.on('render-process-gone', () => { void this.setVisible(false).catch(error => this.failed(error)); });
    }
    applyBoardWindowOptions(this.window, this.windowOptions);
    this.window.setResizable(this.cameraMode.backdrop !== 'camera');
    applyBoardCapturePolicy(this.window, this.presentation.mode);
    this.window.hide(); this.window.setBounds(bounds); this.visible = false;
    if (!preview && wasPreview) this.journal.seedLayout(this.layout(this.resumeVisible, bounds));
    // Reload between recordings only. Hiding within one session preserves the document.
    await this.window.loadURL('frameflow://app/index.html?overlay=whiteboard');
    return captureWindowHandle(this.window.getNativeWindowHandle(), process.platform);
  }
  async setVisible(visible: boolean, fresh = true): Promise<void> {
    try { await this.changeVisibility(visible, fresh); }
    catch (error) {
      diagnostic('whiteboard.visibility-failed', error, { visible, presentation: this.presentation.mode,
        backdrop: this.cameraMode.backdrop, session: this.journal.session, cameraAvailable: this.camera.state?.cameraAvailable,
        windowVisible: this.window?.isVisible() });
      throw error;
    }
  }
  private async openMode(mode: BoardMode): Promise<void> {
    await this.ensurePreview();
    if (mode !== 'camera' && this.cameraMode.backdrop === 'camera') {
      if (this.visible) await this.cameraMode.configure('white', undefined);
      else await this.cameraMode.restore();
    }
    if (this.windowOptions.passthrough) await this.configureWindow(this.journal.session, { passthrough: false });
    if (mode !== 'camera') {
      await this.configurePresentation(mode);
      if (!this.visible) await this.setVisible(true);
      return;
    }
    if (!this.camera.available()) throw new Error('请先开启并连接摄像头');
    if (this.visible) { await this.cameraMode.configure('camera', undefined); return; }
    if (this.cameraMode.backdrop === 'camera') await this.cameraMode.restore();
    await this.journal.newBoard();
    await this.cameraMode.configure('camera', undefined, () => this.setVisible(true, false));
  }
  private async configurePresentation(mode: BoardPresentation): Promise<void> {
    if (!this.window || !this.available) throw new Error('白板会话已失效');
    if (mode === 'interface' && !this.presentation.supported) throw new Error('完整界面录制模块不可用');
    if (mode === 'interface' && this.windowOptions.transparent) this.requireInterfaceTransparency();
    const session = this.journal.session;
    applyBoardCapturePolicy(this.window, mode);
    try { await this.syncPresentation(mode, this.visible); }
    catch (error) { applyBoardCapturePolicy(this.window, this.presentation.mode); throw error; }
    if (!this.available || session !== this.journal.session) return;
    this.presentation.mode = mode;
    applyBoardWindowOptions(this.window, this.windowOptions);
    if (this.visible) await this.journal.append(this.layout(true, this.window.getBounds()));
    this.publish();
  }
  private async changeVisibility(visible: boolean, fresh: boolean): Promise<void> {
    if (visible && ['idle', 'error'].includes(this.status)) await this.ensurePreview();
    if (!this.available || !this.window || !this.area) throw new Error('白板正在准备，请稍候');
    if (visible && (!this.usableArea || this.usableArea.width < 320 || this.usableArea.height < 250)) throw new Error('录制区域太小，请选择至少 320 × 250 的区域使用白板');
    if (visible === this.visible) return;
    if (visible && fresh && this.cameraMode.backdrop === 'camera') await this.cameraMode.restore();
    if (visible && this.windowOptions.passthrough) {
      this.windowOptions = { ...this.windowOptions, passthrough: false };
      applyBoardWindowOptions(this.window, this.windowOptions);
    }
    if (visible && this.window.webContents.isCrashed())
      await this.window.loadURL('frameflow://app/index.html?overlay=whiteboard');
    if (visible && this.presentation.mode === 'canvas') await this.syncPresentation('canvas', false);
    if (!visible) await this.syncPresentation(this.presentation.mode, false);
    if (!visible) { this.cameraMode.cancel(); this.visibilityGate.cancel(); }
    if (!this.available) { this.window.hide(); return; }
    if (visible && fresh) await this.journal.newBoard();
    if (!this.available) { this.window.hide(); return; }
    if (!visible) await this.journal.append(this.layout(false, this.window.getBounds()));
    if (!this.available) { this.window.hide(); return; }
    this.visible = visible;
    this.camera.cover(visible && this.cameraMode.backdrop === 'camera');
    if (!visible) this.camera.close();
    if (!visible) this.resumeVisible = false;
    this.error = undefined;
    if (visible) {
      try { await this.visibilityGate.wait(() => this.publish()); }
      catch (error) { this.visible = false; this.camera.close(); this.camera.cover(false); this.window.hide(); this.publish(); throw error; }
      if (this.visible && this.available) {
        if (this.cameraMode.transition) this.cameraMode.transition.startedAt = Date.now() / 1000;
        if (this.presentation.mode === 'canvas') await this.journal.append(this.layout(true, this.window.getBounds()));
        if (!this.visible || !this.available) { this.window.hide(); return; }
        this.publish();
        applyBoardCapturePolicy(this.window, this.presentation.mode);
        this.window.show();
        if (this.presentation.mode === 'interface') {
          try { await this.syncPresentation('interface', true); }
          catch (error) {
            this.visible = false; this.window.hide(); this.camera.cover(false); this.publish(); throw error;
          }
          if (!this.available) { this.window.hide(); return; }
          await this.journal.append(this.layout(true, this.window.getBounds()));
          if (!this.available) { this.window.hide(); return; }
        }
      }
      void this.speech.ready().catch(() => {});
    } else { this.window.hide(); void this.speech.shutdown(); }
    this.publish();
  }
  private moved(): void {
    if (this.positioning || !this.window || !this.area || !this.available) return;
    if (this.cameraMode.backdrop === 'camera' || this.cameraMode.transition) return;
    const current = this.window.getBounds(), bounded = clampBoard(current, this.usableArea!);
    if (JSON.stringify(current) !== JSON.stringify(bounded)) {
      this.positioning = true; this.window.setBounds(bounded); this.positioning = false;
    }
    if (this.visible) void this.journal.append(this.layout(true, bounded)).catch(error => this.failed(error));
  }
  private failed(error: unknown): void {
    diagnostic('whiteboard.failed', error);
    this.error = `白板保存失败：${error instanceof Error ? error.message : String(error)}`;
    this.publish();
  }
  dispose(): void {
    this.disposed = true;
    this.visibilityGate.cancel();
    this.camera.close(); this.camera.cover(false);
    if (this.shortcutRegistered) globalShortcut.unregister('CommandOrControl+Shift+B');
    void this.speech.shutdown();
    for (const channel of this.channels) ipcMain.removeHandler(channel);
    this.window?.destroy(); this.window = undefined;
  }
}
