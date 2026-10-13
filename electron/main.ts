import { SpeechSession } from './services/whiteboard/speech-session';
import { installRegionSelection } from './services/region-selection';
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, screen, Tray } from 'electron';
import { createDemoIntegration } from './services/demo/integration';
import { updateAppTray } from './services/app-tray';
import { configureCaptureRuntime } from './services/capture-runtime-configuration';
import { createEditorWindow } from './services/editor-window';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { NativeClient } from './services/native-client';
import { ProjectStore } from './services/projects';
import { RecordingController } from './services/recording';
import { Exporter } from './services/exporter';
import { ExportRenderer } from './services/export-renderer';
import { installExportIpc } from './services/export-ipc';
import { disposeMediaProcesses, ffmpegAvailable } from './services/ffmpeg';
import { disposeBackgroundProcesses } from './services/background-image';
import { installProtocol } from './services/protocol';
import { CameraManager } from './services/camera';
import { diagnostic, flushDiagnostics } from './services/diagnostics';
import { RecordingHud } from './services/recording-hud';
import { RecorderLauncher } from './services/recorder-launcher';
import { installCameraPermissions } from './services/media-permissions';
import { revealWindow } from './services/window-visibility';
import type { MicrophoneDevice, Project } from '../shared/types';
import { APP_NAME } from '../shared/brand';
import { initializeApplicationBranding } from './services/app-branding';
import { trayIcon } from './services/tray-icon';
import { userPreferences } from './services/user-preferences';
import { MicrophoneSession } from './services/microphone-session';
import { installMicrophoneIpc } from './services/microphone-ipc';
import { cancelMicrophoneEffects, disposeMicrophoneEffects } from './services/microphone-effects';
import { cancelProjectAudio, disposeProjectAudio } from './services/project-audio';
import { audioCacheManager, disposeAudioCache } from './services/audio-cache';
import { installAudioCacheIpc } from './services/audio-cache-ipc';
import { createLiveIntegration } from './services/live/integration';
import { installToolbarIntegration } from './services/toolbar-integration';
import { createDistribution } from './services/distribution';
import { installPlatformPermissions } from './services/platform/permissions';
import { WhiteboardWindow } from './services/whiteboard/window';
import { WhiteboardPresentation } from './services/whiteboard/presentation';
import { installRecordingPresentation } from './services/recording/presentation';
import { PermissionStartupWindow } from './services/platform/permission-startup-window';
import { recordingCameraCallbacks } from './services/recording-camera-callbacks';
import { installApplicationLifecycle } from './services/application-lifecycle';

initializeApplicationBranding(app);

configureCaptureRuntime(app);

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const native = new NativeClient();
// Explicit local acceptance runs keep media separate from the user's normal Movies library.
const acceptanceRoot = app.commandLine.getSwitchValue('smorec-test-root');
if (acceptanceRoot && path.isAbsolute(acceptanceRoot)) {
  const temporary = path.join(acceptanceRoot, '.tmp');
  mkdirSync(temporary, { recursive: true }); app.setPath('temp', temporary);
}
const projects = new ProjectStore({ onDeleted: () => audioCacheManager().schedule(0),
  ...(acceptanceRoot && path.isAbsolute(acceptanceRoot) ? { root: () => acceptanceRoot } : {}) });
const microphoneSession = new MicrophoneSession(projects);
const exporter = new Exporter(projects);
const exportRenderer = new ExportRenderer(exporter, projects, rendererUrl);
const exportBusy = () => exporter.isActive() || exportRenderer.isActive();
const camera = new CameraManager();
const hud: RecordingHud = new RecordingHud({
  toolbarWindow: () => launcher.getWindow(),
  onStop: () => stopFromControl(),
  onAction: async action => {
    if (live.session.active()) {
      await live.cameraControls.control(action);
      if (action.type === 'camera-visible' && !action.value) {
        recording.controls.endPreview(); launcher.cameraEnabled(false);
      }
      return;
    }
    const state = recording.controls.snapshot();
    if (state.cameraPreviewing && action.type === 'camera-visible' && !action.value) {
      recording.controls.endPreview(state.cameraSessionId); launcher.cameraEnabled(false); return;
    }
    await recording.controls.control(action);
    if (action.type === 'camera-effects') launcher.cameraEffects(recording.controls.snapshot().cameraEffects!);
  },
  onPreviewRequest: sessionId => launcher.previewRequest(sessionId),
  onPreviewSignal: message => launcher.previewSignal(message),
  onCameraPlacement: center => recording.controls.placement(center),
  onCameraSettingsChanged: open => live.session.cameraSettingsChanged(open),
  onCameraState: (state, bounds) => whiteboard.updateCamera(state, bounds),
  onAuxiliaryPreview: message => whiteboard.cameraSignal(message),
});
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let allowClose = false;
let quitting = false;
let startupReady = false;
let windowErrorShown = false;
let editorReady = false;
let pendingSave: Promise<void> | undefined;
let closeWait: { token: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
const recording = new RecordingController(native, projects, camera, userPreferences);
const whiteboard = new WhiteboardWindow(recording.whiteboard, () => hud.getToolbarWindow(), () => allowClose,
  new SpeechSession(native), new WhiteboardPresentation(native, async (id, visible) => {
    if (live.session.state.status !== 'live') return false;
    await live.session.setWhiteboard(id, visible); return true;
  }), { request: session => launcher.previewRequest(session), signal: message => launcher.previewSignal(message),
    covered: value => hud.setCameraCovered(value) });
let openingRecorder: Promise<void> | undefined;
let wakingRecorder = false;
const launcher: RecorderLauncher = new RecorderLauncher({
  getStatus: () => ({ nativeAvailable: native.available(), ffmpegAvailable: ffmpegAvailable(), platform: process.platform, version: app.getVersion() }),
  getSources: () => recording.sources(),
  getMicrophones: () => native.request<MicrophoneDevice[]>('microphone-devices'),
  onSetExcludedApplications: applications => recording.setExcludedApplications(applications),
  onOpenCameraSettings: () => live.session.active() ? live.cameraControls.open() : hud.setCameraSettings(true),
  onStart: async options => {
    if (quitting) throw new Error('应用正在退出');
    if (live.session.active()) throw new Error('请先结束直播投屏');
    if (exportBusy()) throw new Error('请先完成或取消当前导出');
    await microphoneSession.suspend();
    cancelProjectAudio();
    cancelMicrophoneEffects();
    try { await recording.start(options); }
    catch (error) { if (!quitting) await launcher.show(); throw error; }
  },
  onOpenEditor: async () => {
    if (quitting || recording.isActive() || live.session.active()) throw new Error('请先停止当前采集');
    await microphoneSession.suspend();
    recording.controls.endPreview();
    await camera.dispose(); await openEditor();
  },
  onQuit: () => shutdown(),
  ...recordingCameraCallbacks({ camera, recording, hud, launcher: () => launcher,
    live: () => ({ active: live.session.active(), status: live.session.state.status }), quitting: () => quitting }),
  onCreated: owner => installCameraPermissions(owner, camera, value => value === 'frameflow://app/index.html?overlay=launcher'),
  onFailure: error => {
    if (quitting || allowClose) return;
    recording.controls.endPreview();
    void (async () => {
      await live.session.stop('直播操作界面已关闭');
      if (recording.isActive()) await stopFromControl(); else await camera.dispose();
      showWindowError(`${APP_NAME}录制栏已停止`, `${error.message}。请重新打开应用；已录制的原始素材会保留。`);
    })().catch(failure => diagnostic('recorder.failure-recovery', failure));
  },
});

const live = createLiveIntegration({ recording, launcher, hud, whiteboard, editor: () => window,
  demo: { prepare: sourceId => demo.prepare('live', sourceId), enabled: () => demo.controller.state.enabled,
    captureOptions: () => demo.captureOptions(), status: status => demo.status('live', status) },
  applications: () => native.request('live-applications'),
  idle: () => !quitting && !recording.isActive() && !exportBusy(), quitting: () => quitting,
  suspendAudio: async () => { await microphoneSession.suspend(); cancelProjectAudio(); cancelMicrophoneEffects(); },
  changed: () => { distribution.activity('live', live.session.state.status); updateTray(); } });
const demo = createDemoIntegration({ recording, live: () => live.session,
  trusted: event => launcher.isTrusted(event) || trusted(event)
    || event.sender === hud.getToolbarWindow()?.webContents && event.senderFrame === event.sender.mainFrame,
  editor: async () => { await ensureEditor(); showMainWindow(); },
  presentationHidden: hidden => hud.setPresentationHidden(hidden), changed: () => {
    whiteboard.setDemoVisibility(demo.controller.state.active && demo.controller.state.visible); updateTray();
  } });
recording.demoOptions = demo.captureOptions;
const distribution = createDistribution({ window: () => launcher.getWindow(), trusted: event => launcher.isTrusted(event),
  busy: () => quitting || recording.isActive() || live.session.active() || exportBusy(),
  restart: () => shutdown(true),
  beforeUpdateQuit: async () => { await flushDiagnostics(); allowClose = true; },
  cancelUpdateQuit: () => { allowClose = false; } });
const permissionStartup = new PermissionStartupWindow(native, () => shutdown(), () => distribution.confirmStartup());

async function openRecorder(): Promise<void> {
  if (quitting) return;
  if (demo.controller.state.desktopHidden) await demo.controller.toggleDesktop();
  if (live.session.active()) { live.showControls(); return; }
  if (exportBusy()) throw new Error('视频正在导出，请完成或取消导出后返回录制栏');
  if (recording.isActive()) { hud.setPresentationHidden(false); launcher.showControls(); return; }
  if (!await permissionStartup.ensure()) return;
  if (openingRecorder) return openingRecorder;
  openingRecorder = (async () => {
    if (window?.isVisible()) await saveBeforeClose();
    await microphoneSession.suspend();
    if (quitting) return;
    await launcher.show();
    if (quitting) { launcher.hide(); return; }
    window?.hide();
  })();
  try { await openingRecorder; } finally { openingRecorder = undefined; }
}
function wakeRecorder(): void {
  if (quitting || wakingRecorder) return;
  wakingRecorder = true;
  void openRecorder().catch(error => {
    if (!quitting && !allowClose) dialog.showErrorBox('无法打开录制栏', error instanceof Error ? error.message : String(error));
  }).finally(() => { wakingRecorder = false; });
}

function showMainWindow(): void {
  if (!app.isReady() || !window || window.isDestroyed() || window.webContents.isCrashed() || !editorReady) return;
  const primary = screen.getPrimaryDisplay();
  const displays = [primary, ...screen.getAllDisplays().filter(display => display.id !== primary.id)];
  const maximized = userPreferences.read().editorMaximized;
  revealWindow(window, displays.map(display => display.workArea));
  if (maximized) window.maximize();
}
async function ensureEditor(): Promise<void> {
  if (editorReady && window && !window.isDestroyed() && !window.webContents.isCrashed()) return;
  let cleanup = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    const listener = (event: Electron.IpcMainEvent) => { if (trusted(event)) { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('编辑器未能加载，请重新打开应用；已保存的录制仍在工程目录')); }, 15_000);
    cleanup = () => { clearTimeout(timer); ipcMain.removeListener('studio:ready', listener); };
    ipcMain.on('studio:ready', listener);
  });
  void ready.catch(() => {});
  try {
    if (!window || window.isDestroyed()) await createWindow();
    else if (window.webContents.isCrashed()) await window.loadURL(rendererUrl ?? 'frameflow://app/index.html');
    await ready;
  } finally { cleanup(); }
}
async function openEditor(project?: Project): Promise<void> {
  if (!await permissionStartup.ensure()) return;
  await ensureEditor();
  if (project) window?.webContents.send('studio:project-ready', project);
  if (quitting) return;
  launcher.hide(); showMainWindow();
}
function showWindowError(title: string, message: string): void {
  if (windowErrorShown) return;
  windowErrorShown = true;
  dialog.showErrorBox(title, message);
}

function trustedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return rendererUrl ? url.origin === new URL(rendererUrl).origin : url.protocol === 'frameflow:' && url.hostname === 'app';
  } catch { return false; }
}

function trusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  return trustedUrl(event.senderFrame.url);
}
function requireWindow(): BrowserWindow { if (!window) throw new Error('应用窗口尚未准备好'); return window; }
function handle(channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (!trusted(event)) throw new Error('请求来源不受信任');
    try { return await handler(...args); }
    catch (error) { diagnostic(`ipc.${channel}`, error); throw error; }
  });
}
function registerIpc(): void {
  ipcMain.on('studio:ready', event => { if (trusted(event)) editorReady = true; });
  handle('studio:status', () => ({ nativeAvailable: native.available(), ffmpegAvailable: ffmpegAvailable(), platform: process.platform, version: app.getVersion() }));
  handle('studio:sources', () => recording.sources());
  handle('studio:microphones', () => native.request<MicrophoneDevice[]>('microphone-devices'));
  handle('studio:open-recorder', () => openRecorder());
  handle('studio:record-stop', () => recording.stop());
  handle('studio:projects', () => projects.list());
  handle('studio:project-load', (id) => projects.load(id));
  handle('studio:project-save', (project) => projects.save(project));
  handle('studio:project-rename', (id, name) => projects.rename(id, name));
  handle('studio:project-reveal', (id) => projects.reveal(id));
  handle('studio:project-delete', (ids) => projects.deleteProjects(ids, () => {
    if (quitting) return '应用正在退出，请稍后管理工程';
    if (recording.isActive()) return '请先停止当前录制，再删除工程';
    if (exportBusy()) return '请先完成或取消当前导出，再删除工程';
  }));
  handle('studio:import', () => projects.importVideo(requireWindow()));
  handle('studio:background-import', (id) => projects.importBackground(id, requireWindow()));
  handle('studio:project-open', () => projects.open(requireWindow()));
  installExportIpc({ handle, window: requireWindow, exporter, renderer: exportRenderer,
    capturing: () => quitting || recording.isActive() || live.session.active(),
    finished: success => distribution.telemetry.track('export_end', success
      ? { outcome: 'success' } : { outcome: 'failure', error_code: 'export_failed' }) });
  ipcMain.on('studio:window', (event, action: unknown) => {
    if (!trusted(event) || !window) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); }
    if (action === 'close') window.close();
  });
  ipcMain.on('studio:close-ready', (event, response: unknown) => {
    if (!trusted(event) || !closeWait || !response || typeof response !== 'object') return;
    const result = response as { token?: unknown; ok?: unknown; error?: unknown };
    if (result.token !== closeWait.token) return;
    const pending = closeWait;
    closeWait = undefined;
    clearTimeout(pending.timer);
    if (result.ok === true) pending.resolve();
    else pending.reject(new Error(typeof result.error === 'string' ? result.error.slice(0, 500) : '自动保存失败'));
  });
}
async function saveBeforeClose(): Promise<void> {
  if (pendingSave) return pendingSave;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isCrashed() || window.webContents.isLoadingMainFrame()) return;
  pendingSave = new Promise<void>((resolve, reject) => {
    const token = randomUUID();
    const timer = setTimeout(() => {
      if (closeWait?.token === token) closeWait = undefined;
      reject(new Error('自动保存未在 5 秒内完成，请稍后再关闭。'));
    }, 5000);
    closeWait = { token, resolve, reject, timer };
    window!.webContents.send('studio:before-close', token);
  }).finally(() => { pendingSave = undefined; });
  return pendingSave;
}
async function stopFromControl(): Promise<void> {
  if (live.session.active()) { await live.session.stop(); return; }
  if (!recording.isActive()) return;
  try { await recording.stop(); }
  catch (error) {
    if (!quitting) await launcher.show().catch(failure => diagnostic('recorder.restore', failure));
    dialog.showErrorBox('录制未能正常保存', error instanceof Error ? error.message : String(error));
  }
}
function updateTray(): void {
  updateAppTray(tray, { recording: recording.isActive(), live: live.session.active(), demo: demo.items(),
    wake: wakeRecorder, stop: stopFromControl, quit: shutdown });
}
async function shutdown(restart = false): Promise<void> {
  if (quitting) return;
  quitting = true;
  try {
    await saveBeforeClose();
    await live.session.stop();
    if (recording.isActive()) await stopFromControl();
    await exportRenderer.dispose();
    await exporter.dispose();
    await microphoneSession.suspend();
    disposeProjectAudio();
    disposeMicrophoneEffects();
    disposeAudioCache();
    await camera.dispose();
    disposeMediaProcesses();
    disposeBackgroundProcesses();
    recording.dispose();
    await distribution.stop();
    await flushDiagnostics();
    allowClose = true;
    demo.dispose();
    launcher.dispose();
    hud.dispose();
    whiteboard.dispose();
    userPreferences.flush();
    if (restart) app.relaunch({ args: process.argv.slice(1).filter(value => value !== '--updated'
      && !value.startsWith('--mac-update-session=') && !value.startsWith('--mac-update-system-session=')) });
    app.quit();
  } catch (error) {
    if (recording.isActive()) await stopFromControl();
    quitting = false;
    showMainWindow();
    dialog.showErrorBox('尚未退出，工程需要保存', error instanceof Error ? error.message : String(error));
  }
}
async function createWindow(): Promise<void> {
  window = await createEditorWindow({ rendererUrl, preloadDirectory: __dirname,
    created: editor => { window = editor; },
    quitting: () => quitting, allowClose: () => allowClose, recording: () => recording.isActive(),
    ready: value => { editorReady = value; }, closed: () => { window = undefined; },
    wake: wakeRecorder, stop: () => { void stopFromControl(); }, error: showWindowError });
}
installApplicationLifecycle({ ready: () => startupReady, wake: wakeRecorder, allowClose: () => allowClose,
  shutdown: () => shutdown(), initialize: async () => {
    if (await distribution.updater.installPendingOnStartup()) return;
    await projects.initialize();
    startupReady = true;
    installProtocol(projects, rendererUrl, token => microphoneSession.media(token),
      (session, asset) => recording.whiteboard.assetFile(session, asset), token => microphoneSession.mediaSignal(token));
    registerIpc();
    installAudioCacheIpc(event => launcher.isTrusted(event));
    audioCacheManager().setMaintenanceAllowed(() => !quitting && !recording.isActive() && !live.session.active() && !exportBusy());
    audioCacheManager().schedule();
    live.install();
    installRegionSelection({ trusted: event => launcher.isTrusted(event) || trusted(event), sources: () => recording.sources(),
      idle: () => !quitting && !recording.isActive() && !live.session.active() && !exportBusy(),
      hide: owner => { if (owner === launcher.getWindow()) launcher.hide(); else owner?.hide(); },
      restore: owner => {
        if (quitting) return;
        if (owner === launcher.getWindow()) launcher.showControls(); else if (owner && !owner.isDestroyed()) owner.show();
      }, rendererUrl });
    demo.install();
    distribution.installIpc();
    installPlatformPermissions({ trusted: event => launcher.isTrusted(event) || permissionStartup.isTrusted(event), native,
      busy: () => quitting || recording.isActive() || live.session.active() || exportBusy() });
    installToolbarIntegration({ launcher: () => launcher.getWindow(), toolbar: () => hud.getToolbarWindow(),
      activity: () => ({ recording: recording.isActive(), live: live.session.active(), exporting: exportBusy(), quitting }),
      quit: () => shutdown() });
    installMicrophoneIpc(microphoneSession, { editor: () => window, recorder: () => launcher.getWindow(),
      idle: () => !quitting && !recording.isActive() && !live.session.active(), trustedEditor: trusted });
    camera.onCommand = command => launcher.cameraCommand(command);
    projects.onRecovered = (name, warnings) => {
      const messages = [`${name}已找回，原始恢复文件已保留`, ...warnings];
      window?.webContents.send('studio:record-state', { status: recording.state.status, warnings: messages });
    };
    if (!await permissionStartup.ensure()) return;
    await createWindow();
    tray = new Tray(trayIcon(false));
    tray.on('double-click', wakeRecorder);
    installRecordingPresentation({ recording, launcher, hud, whiteboard, demo, editor: () => window,
      quitting: () => quitting, openProject: openEditor, changed: state => {
        distribution.activity('recording', state.status);
        window?.webContents.send('studio:record-state', state); updateTray();
      } });
    updateTray();
    await launcher.show();
    await distribution.start();
    if (!globalShortcut.register('CommandOrControl+Shift+R', () => { void stopFromControl(); })) {
      console.warn('录制停止快捷键已被其他应用占用，请使用系统托盘停止录制。');
    }
  }, failed: (error: unknown) => {
    diagnostic('app.startup-failed', error);
    showWindowError(`${APP_NAME}启动失败`, String(error)); allowClose = true; launcher.dispose(); hud.dispose(); whiteboard.dispose(); app.quit();
  }, dispose: () => { globalShortcut.unregisterAll(); tray?.destroy(); launcher.dispose(); hud.dispose(); whiteboard.dispose(); }
});
