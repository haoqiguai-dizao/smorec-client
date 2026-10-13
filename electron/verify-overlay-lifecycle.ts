/** Actual isolated overlays, driven by a generated canvas. No native capture or device access. */
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RecordingHud } from './services/recording-hud';
import { installProtocol } from './services/protocol';
import { ProjectStore } from './services/projects';
import { flushDiagnostics } from './services/diagnostics';
import type { CameraPreviewMessage, LiveRecordingState, RecordingControlAction } from '../shared/types';

const directory = path.resolve(app.getAppPath(), '..');
app.setPath('userData', path.join(directory, 'profile'));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check: () => Promise<unknown> | unknown, label: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await Promise.race([Promise.resolve().then(check).catch(() => false), delay(300).then(() => false)])) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const initial: LiveRecordingState = { status: 'idle', cameraAvailable: true, cameraVisible: true, cameraSize: .22,
  cameraShape: 'circle', cameraMirror: true, microphoneEnabled: false, microphoneMuted: false, microphoneName: '',
  systemAudioEnabled: false, systemAudioMuted: false };
let hud: RecordingHud | undefined, host: BrowserWindow | undefined;
app.whenReady().then(async () => {
  let permissionRequests = 0;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => { permissionRequests++; callback(false); });
  session.defaultSession.setPermissionCheckHandler(() => false);
  installProtocol(new ProjectStore());
  host = new BrowserWindow({ show: false, webPreferences: { preload: path.join(app.getAppPath(), 'host-preload.cjs'),
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  const consoleErrors: string[] = [], sessions: string[] = [];
  const loads = new Map<number, number>();
  const observe = (window: BrowserWindow) => {
    const id = window.webContents.id;
    window.webContents.on('did-finish-load', () => loads.set(id, (loads.get(id) ?? 0) + 1));
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) consoleErrors.push(message); });
  };
  observe(host);
  app.on('browser-window-created', (_event, window) => observe(window));
  let state = { ...initial }, stopCount = 0;
  let firstRequestForwarded = false;
  const firstViewports: { sessionId: string; revision: number; beforeRequest: boolean }[] = [];
  const update = (changes: Partial<LiveRecordingState>) => { state = { ...state, ...changes }; hud!.update(state); };
  const action = (value: RecordingControlAction) => {
    if (value.type === 'camera-visible') update({ cameraVisible: value.value });
    else if (value.type === 'camera-shape') update({ cameraShape: value.value });
    else if (value.type === 'camera-size') update({ cameraSize: value.value });
  };
  hud = new RecordingHud({
    onStop: () => { stopCount++; update({ status: 'idle' }); }, onAction: action,
    onPreviewRequest: async id => {
      sessions.push(id);
      // Exercise cross-renderer ordering: the initial viewport reaches a host with no sender yet.
      if (sessions.length === 1) { await delay(250); firstRequestForwarded = true; }
      host!.webContents.send('overlay-test:request', id);
    },
    onPreviewSignal: message => {
      if (message.signal.type === 'viewport' && message.signal.viewport && sessions.length <= 1) {
        firstViewports.push({ sessionId: message.sessionId, revision: message.signal.viewport.revision,
          beforeRequest: !firstRequestForwarded });
      }
      host!.webContents.send('overlay-test:signal-incoming', message);
    }, onCameraPlacement: () => {},
  });
  ipcMain.handle('overlay-test:signal', (event, message: CameraPreviewMessage) => {
    assert.equal(event.sender, host!.webContents); assert.equal(event.senderFrame, host!.webContents.mainFrame);
    assert.equal(event.senderFrame!.url, 'frameflow://app/synthetic-host.html');
    hud!.signalFromHost(message);
  });
  const executeHost = (code: string) => host!.webContents.executeJavaScript(code);
  await host.loadURL('frameflow://app/synthetic-host.html');
  await waitFor(() => executeHost('typeof overlaySynthetic === "object"'), 'synthetic host');
  const overlay = (role: string) => {
    const window = BrowserWindow.getAllWindows().find(value => value.webContents.getURL().endsWith('?overlay=' + role));
    assert.ok(window, role + ' window must exist'); return window;
  };
  const execute = (role: string, code: string) => overlay(role).webContents.executeJavaScript(code);
  const videoState = () => execute('camera', `(() => { const video = document.querySelector('video'); return video && {
    time: video.currentTime, width: video.videoWidth, paused: video.paused, state: video.readyState, streamId: video.srcObject?.id,
    frames: video.getVideoPlaybackQuality().totalVideoFrames }; })()`);
  async function livePreview(): Promise<void> {
    await waitFor(async () => {
      const video = await videoState(); return video?.width > 0 && video.state >= 2 && !video.paused && video.time > .1;
    }, 'live camera overlay');
    const before = await videoState();
    await waitFor(async () => {
      const next = await videoState(); return next.time > before.time && next.frames > before.frames;
    }, 'Camera preview must keep advancing');
  }
  const click = (label: string) => execute('toolbar', `(() => { const button = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!button || button.disabled) throw new Error('Missing enabled button'); button.click(); })()`);
  await executeHost('overlaySynthetic.start()');
  update({ cameraPreviewing: true, cameraSessionId: 'preview-a' }); await livePreview();
  const earlyViewport = firstViewports.find(viewport => viewport.beforeRequest);
  assert.ok(earlyViewport, 'The first viewport must actually be forwarded before the delayed host request');
  assert.equal(earlyViewport.sessionId, sessions[0]);
  assert.ok(firstViewports.some(viewport => !viewport.beforeRequest && viewport.sessionId === sessions[0]
    && viewport.revision > earlyViewport.revision), 'The production receiver must replay fresh demand after receiving the offer');
  const previewHandle = hud.getWindowHandles().camera;
  assert.equal(hud.getWindowHandles().toolbar, undefined, 'Idle preview must not create the recording toolbar');
  assert.ok(overlay('camera').isVisible(), 'Ready camera must appear on the desktop before recording');
  assert.equal(await execute('camera', 'Array.from(document.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "画面设置")?.disabled'), false);
  // Replacing a stream while availability stays true must renegotiate the receiver.
  const previousStream = (await videoState()).streamId;
  await executeHost('overlaySynthetic.stop(); overlaySynthetic.start()');
  update({ cameraSessionId: 'preview-b' });
  await waitFor(async () => { const next = await videoState(); return next?.streamId && next.streamId !== previousStream; }, 'replacement source received');
  await livePreview();
  assert.equal(sessions.length, 2, 'Changing acquisition identity starts a fresh preview peer');
  assert.equal(hud.getWindowHandles().camera, previewHandle);
  update({ status: 'starting', cameraPreviewing: false });
  const originalHandles = hud.getWindowHandles();
  update({ status: 'recording', startedAtUnixMs: Date.now() }); await livePreview();
  await waitFor(() => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('?overlay=toolbar')
    && window.isVisible()), 'recording toolbar ready');
  assert.equal(hud.getWindowHandles().camera, previewHandle, 'Starting must reuse the pre-recording camera HWND');
  assert.equal(sessions.length, 2, 'Starting must keep the same preview stream and connection');
  assert.equal(await execute('toolbar', 'typeof window.studio'), 'undefined');
  assert.equal(await execute('camera', 'typeof window.studio'), 'undefined');
  assert.ok(overlay('toolbar').isVisible() && overlay('camera').isVisible());
  await click('隐藏摄像头'); await waitFor(() => !overlay('camera').isVisible(), 'camera hidden');
  await delay(400); const hiddenFrames = await executeHost('overlaySynthetic.encodedFrames()');
  await delay(1200);
  assert.equal(await executeHost('overlaySynthetic.encodedFrames()'), hiddenFrames, 'The real hidden overlay must stop its sender encoding');
  assert.equal(await executeHost('overlaySynthetic.live()'), true);
  await click('显示摄像头'); await waitFor(() => overlay('camera').isVisible(), 'camera restored'); await livePreview();
  assert.equal(sessions.length, 2, 'Hiding preview must keep the original peer and source track');
  assert.ok(await executeHost('overlaySynthetic.encodedFrames()') > hiddenFrames, 'Showing the real overlay must resume encoding');
  await click('画面设置');
  await waitFor(() => execute('camera', '!!document.querySelector("section[aria-label=画面设置]")'), 'camera settings expanded');
  await click('停止并编辑'); await waitFor(() => stopCount === 1 && !overlay('toolbar').isVisible(), 'first round stopped');
  await waitFor(() => execute('camera', 'document.querySelector("video")?.srcObject === null'), 'idle peer disposed');
  await executeHost('overlaySynthetic.stop(); overlaySynthetic.start()');
  update({ status: 'starting' }); update({ status: 'recording', startedAtUnixMs: Date.now() }); await livePreview();
  assert.equal(sessions.length, 3); assert.notEqual(sessions[1], sessions[2]);
  assert.deepEqual(hud.getWindowHandles(), originalHandles, 'Native HWNDs remain stable across recordings');
  assert.equal(overlay('toolbar').getBounds().height, 78);
  assert.equal(await execute('camera', 'document.querySelector("section[aria-label=画面设置]") === null'), true);
  overlay('camera').webContents.forcefullyCrashRenderer();
  await waitFor(() => sessions.length >= 4, 'new handshake after camera renderer crash'); await livePreview();
  assert.deepEqual(hud.getWindowHandles(), originalHandles, 'Camera recovery must retain capture-excluded HWND');
  const toolbarLoadCount = loads.get(overlay('toolbar').webContents.id)!;
  overlay('toolbar').webContents.forcefullyCrashRenderer();
  await waitFor(() => loads.get(overlay('toolbar').webContents.id)! > toolbarLoadCount, 'toolbar renderer actually reloaded');
  await waitFor(() => execute('toolbar', '!!document.querySelector(".overlay-stop:not(:disabled)")'), 'stop control after toolbar renderer crash');
  assert.deepEqual(hud.getWindowHandles(), originalHandles);
  // A second crash exhausts automatic recovery; the visible error must still offer a stop.
  let stopDialog = false;
  dialog.showMessageBox = (async (options: Electron.MessageBoxOptions) => {
    assert.equal(options.buttons?.[0], '停止并保存'); stopDialog = true;
    return { response: 0, checkboxChecked: false };
  }) as typeof dialog.showMessageBox;
  overlay('toolbar').webContents.forcefullyCrashRenderer();
  await waitFor(() => stopDialog && stopCount === 2, 'fallback stop action');
  await executeHost('overlaySynthetic.stop()');
  assert.equal(permissionRequests, 0, 'Synthetic test must never request screen/camera/microphone permission');
  assert.deepEqual(consoleErrors, []);
  const report = { result: 'PASS', rounds: 2, freshPreviewSessions: sessions.length, hideShowKeepsTrack: true,
    stableWindowHandles: true, cameraCrashRecovery: true, toolbarCrashRecovery: true, fallbackStop: true,
    settingsResetOnNextRecording: true, idlePreviewVisible: true, idleCameraControlsEnabled: true,
    replacedSourceReconnects: true, previewToRecordingKeepsPeer: true, hiddenEncodingStops: true,
    showEncodingResumes: true, coldStart: { delayedHostRequestMilliseconds: 250, firstViewports,
      viewportBeforeRequest: true, productionReceiverReplay: true, liveFramesRecovered: true },
    permissionRequests, stopCount, cleanQuitRequested: true };
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  await flushDiagnostics(); console.log(JSON.stringify(report));
  // Match production ordering: destroy close-blocking overlays BEFORE app.quit, not in will-quit.
  hud.dispose(); app.quit();
}).catch(async (error: unknown) => {
  const windows = BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), bounds: window.getBounds(), visible: window.isVisible() }));
  await fs.writeFile(path.join(directory, 'failure.txt'), String(error instanceof Error ? error.stack : error) + '\n' + JSON.stringify(windows)).catch(() => {});
  console.error(error); hud?.dispose(); host?.destroy(); app.exit(1);
});
