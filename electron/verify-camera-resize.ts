import { app, BrowserWindow, ipcMain, screen, session } from 'electron';
import path from 'node:path';
import { RecordingHud } from './services/recording-hud';
import { installProtocol } from './services/protocol';
import { ProjectStore } from './services/projects';
import { userPreferences } from './services/user-preferences';
import type { CameraPreviewMessage, LiveRecordingState, RecordingControlAction } from '../shared/types';

app.setPath('userData', path.join(app.getAppPath(), '..', 'profile'));
app.whenReady().then(async () => {
  let permissions = 0, leaseCount = 0;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => { permissions++; callback(false); });
  session.defaultSession.setPermissionCheckHandler(() => false);
  installProtocol(new ProjectStore());
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  userPreferences.update({ camera: { x: .5, y: .5, size: .22, shape: 'circle', mirror: true, visible: true } });
  const background = new BrowserWindow({ ...area, show: false, frame: false, title: 'SmoRec owned resize-test surface',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await background.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body style="margin:0;background:#283638;color:#fff;font:20px sans-serif;display:grid;place-items:center;height:100vh">SmoRec controlled resize surface<script>window.testClicks=0;addEventListener("pointerdown",()=>window.testClicks++);</script>'));
  background.show(); background.focus();
  const host = new BrowserWindow({ show: false, webPreferences: { preload: path.join(app.getAppPath(), 'host-preload.cjs'),
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  await host.loadURL('frameflow://app/synthetic-host.html');
  await host.webContents.executeJavaScript('overlaySynthetic.start()');
  const actions: RecordingControlAction[] = [], errors: string[] = [];
  let state: LiveRecordingState = { status: 'idle', cameraPreviewing: true, cameraAvailable: true, cameraVisible: true,
    cameraSessionId: 'owned-synthetic-camera', cameraShape: 'circle', cameraSize: .22, cameraMirror: true, cameraMode: 'overlay',
    microphoneEnabled: false, microphoneMuted: false, microphoneName: '', systemAudioEnabled: false, systemAudioMuted: false };
  const patch = (value: Partial<LiveRecordingState>) => { state = { ...state, ...value }; hud.update(state); };
  const hud = new RecordingHud({ onStop: () => patch({ status: 'idle', cameraPreviewing: true }),
    onAction: value => {
      actions.push(value);
      if (value.type === 'camera-size') patch({ cameraSize: value.value });
      if (value.type === 'camera-shape') patch({ cameraShape: value.value });
      if (value.type === 'camera-mode') patch({ cameraMode: value.value });
      if (value.type === 'camera-presenter') patch({ cameraPresenter: value.value });
      if (value.type === 'camera-mirror') patch({ cameraMirror: value.value });
      if (value.type === 'camera-effects') patch({ cameraEffects: { enabled: false, smoothing: 0, brightness: 0,
        filter: 'natural', intensity: 0, ...state.cameraEffects, ...value.value } });
    },
    onPreviewRequest: id => { leaseCount++; host.webContents.send('overlay-test:request', id); },
    onPreviewSignal: value => host.webContents.send('overlay-test:signal-incoming', value), onCameraPlacement: () => {},
  });
  ipcMain.handle('overlay-test:signal', (event, value: CameraPreviewMessage) => {
    if (event.sender !== host.webContents || event.senderFrame !== host.webContents.mainFrame) throw new Error('Unexpected synthetic host');
    hud.signalFromHost(value);
  });
  app.on('browser-window-created', (_event, window) => window.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) errors.push(message);
  }));
  const camera = () => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('?overlay=camera'))!;
  const handle = (window: BrowserWindow) => window.getNativeWindowHandle().readBigUInt64LE().toString();
  Object.assign(globalThis, { resizeHarness: {
    patch, settings: (open: boolean) => hud.setCameraSettings(open),
    snapshot: () => ({ state, actions, leaseCount, permissions, errors, area, cameraBounds: camera().getBounds(),
      cameraHwnd: handle(camera()), backgroundHwnd: handle(background), pid: process.pid }),
    focusBackground: () => { background.show(); background.focus(); },
    clickCount: () => background.webContents.executeJavaScript('window.testClicks'),
    physicalPoint: (point: { x: number; y: number }) => screen.dipToScreenPoint(point),
    close: async () => { await host.webContents.executeJavaScript('overlaySynthetic.stop()'); hud.dispose(); background.destroy(); host.destroy(); },
  } });
  hud.update(state);
});
