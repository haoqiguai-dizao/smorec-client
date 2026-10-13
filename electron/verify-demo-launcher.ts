/** Production launcher UI layout, with capture/device/network actions disabled. */
import { app, BrowserWindow, ipcMain, Menu, session } from 'electron';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ProjectStore } from './services/projects';
import { installProtocol } from './services/protocol';
import { RecorderLauncher } from './services/recorder-launcher';
import { createDemoIntegration } from './services/demo/integration';
import { installToolbarPresentation } from './services/toolbar-presentation';
import { setWindowInputRegions } from './services/platform/window-regions';
import type { RecordingController } from './services/recording';

const root = process.env.XIAOLU_DEMO_ROOT!, output = path.join(root, 'output/demo-mode');
(app as typeof app & { setAppPath(value: string): void }).setAppPath(root);
app.setPath('userData', path.join(output, 'launcher-profile'));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  installProtocol(new ProjectStore({ root: () => path.join(output, 'launcher-projects') }));
  const forbidden = () => { throw Error('Device or capture access forbidden in UI layout check'); };
  const launcher = new RecorderLauncher({
    getStatus: () => ({ platform: process.platform, version: '0.9.65', nativeAvailable: false, ffmpegAvailable: false }),
    getSources: async () => [], getMicrophones: async () => [], onStart: forbidden, onOpenEditor: async () => {},
    onOpenCameraSettings: async () => {}, onQuit: async () => {}, onCameraPrepare: forbidden,
    onCameraStarted: forbidden, onCameraAppend: forbidden, onCameraFinish: forbidden, onCameraCancel: async () => {},
    onCameraFrameStall: () => {}, onCameraFrameResumed: () => {}, onCameraPreviewSignal: () => {},
    onCameraPreviewQuality: () => {}, onCameraPreviewReady: () => {}, onCameraPreviewClosed: () => {}, onCameraPreviewCountdown: () => {},
  });
  const demo = createDemoIntegration({ recording: {} as RecordingController, live: forbidden, trusted: event => launcher.isTrusted(event),
    editor: async () => {}, presentationHidden: () => {}, changed: () => {} }); demo.install();
  installToolbarPresentation({ ipcMain, setRegions: setWindowInputRegions,
    resolveWindow: event => BrowserWindow.fromWebContents(event.sender) ?? undefined });
  ipcMain.handle('live:status', () => ({ installed: false, available: false, name: 'Test' }));
  ipcMain.handle('live:applications', () => []);
  ipcMain.handle('platform:permissions', () => []);
  ipcMain.handle('distribution:state', () => ({ update: { status: 'ready', version: 'test', currentVersion: '0.9.65' }, telemetry: { enabled: false } }));
  await launcher.show(); const window = launcher.getWindow()!;
  await delay(300);
  const layouts: unknown[] = [];
  for (const mode of ['record', 'live']) {
    await window.webContents.executeJavaScript(`(() => { const select = document.querySelector('select[aria-label="工作模式"]');
      select.value = '${mode}'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await delay(150);
    const layout = await window.webContents.executeJavaScript(`(() => {
      const surface = document.querySelector('.launcher-bar').getBoundingClientRect();
      return [...document.querySelectorAll('.launcher-bar button')].filter(button => button.getClientRects().length).map(button => {
        const b = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label') || button.textContent,
          fits: b.left >= surface.left && b.right <= surface.right + 1 }; }); })()`);
    await fs.writeFile(path.join(output, `launcher-${mode}.png`), (await window.webContents.capturePage()).toPNG());
    assert.ok(layout.every((value: { fits: boolean }) => value.fits), JSON.stringify({ mode, layout }));
    layouts.push({ mode, layout });
  }
  let opened = false; const popup = Menu.prototype.popup;
  Menu.prototype.popup = function () { opened = this.items.some(item => item.label === '演示模式'); };
  await window.webContents.executeJavaScript(`document.querySelector('button[aria-label="演示模式"]').click()`);
  await delay(100); Menu.prototype.popup = popup; assert.ok(opened);
  demo.dispose(); launcher.dispose();
  await fs.writeFile(path.join(output, 'launcher-report.json'), JSON.stringify({ result: 'PASS', layouts, menuOpened: opened }, null, 2)); app.exit(0);
}).catch(async error => {
  await fs.writeFile(path.join(output, 'launcher-report.json'), JSON.stringify({ result: 'FAIL', error: error.stack ?? String(error) }, null, 2)); app.exit(1);
});
