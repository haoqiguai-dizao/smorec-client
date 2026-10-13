/** Isolated production entry, legacy window preferences and real region capture; no physical audio/camera. */
import { app, BrowserWindow, dialog, screen, session } from 'electron';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { CaptureSource } from '../shared/types';
import './services/protocol';
import { NativeClient } from './services/native-client';
import { installSyntheticCapture } from './verify-unified-toolbar-fixture';

const root = process.env.XIAOLU_DEMO_ROOT!;
const synthetic = process.env.XIAOLU_SYNTHETIC === '1';
const output = process.env.XIAOLU_VERIFICATION_OUTPUT ?? path.join(root, 'output/unified-toolbar', synthetic ? 'synthetic' : 'native');
const profile = path.join(output, 'profile');
const projects = path.join(output, 'projects');
const report: Record<string, unknown> = { result: 'PENDING', capture: synthetic ? 'SYNTHETIC' : 'NATIVE', physicalDevicesUsed: false, scenarios: [] };
(app as typeof app & { setAppPath(value: string): void }).setAppPath(root);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('smorec-test-root', projects);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T> | T, accept: (value: T) => boolean, label: string, timeout = 15000): Promise<T> {
  const end = Date.now() + timeout;
  let value: T;
  do { value = await read(); if (accept(value)) return value; await delay(100); } while (Date.now() < end);
  throw Error(`Timed out: ${label}; ${JSON.stringify(value)}`);
}
async function button(window: BrowserWindow, label: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('button[aria-label=${JSON.stringify(label)}]');
    if (!button || button.disabled) throw Error('Button unavailable: ' + ${JSON.stringify(label)});
    button.click(); })()`);
}
async function layout(window: BrowserWindow) {
  return window.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('.session-toolbar').getBoundingClientRect();
    return [...document.querySelectorAll('.session-toolbar button')].filter(button => button.getClientRects().length).map(button => {
      const bounds = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') || button.textContent.trim(),
        fits: bounds.left >= surface.left && bounds.right <= Math.min(surface.right, innerWidth) - 1 }; }); })()`);
}

async function inspectNativePresentation(window: BrowserWindow) {
  if (process.platform !== 'win32') return undefined;
  const layout = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('.session-toolbar').getBoundingClientRect();
    const stop = document.querySelector('[data-toolbar-focus="stop"]').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, toolbar: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      stop: { x: stop.x + stop.width / 2, y: stop.y + stop.height / 2 } }; })()`);
  const hwnd = window.getNativeWindowHandle().readBigUInt64LE().toString();
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'scripts/verify-toolbar-native-region.ps1'), '-WindowHandle', hwnd,
    '-OwnerPid', String(process.pid), '-LayoutJson', JSON.stringify(layout), '-TestPointer'], { windowsHide: true });
  const result = JSON.parse(stdout.trim());
  console.log('Native presentation', JSON.stringify(result));
  return result;
}

async function saveScreenshot(window: BrowserWindow, name: string) {
  await fs.writeFile(path.join(output, name + '.png'), (await window.webContents.capturePage()).toPNG());
}
async function run() {
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(projects, { recursive: true });
  await fs.writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ version: 1, canvasDefaultsVersion: 2,
    launcherBounds: { x: 200, y: 700, width: 700, height: 84 },
    toolbarBounds: { x: 400, y: 760, width: 430, height: 78 },
    toolbarArea: { x: 0, y: 0, width: 2304, height: 1206 } }));
  await app.whenReady();
  dialog.showErrorBox = (title, message) => { report.dialogError = { title, message }; };
  // Product permissions may install their own callbacks; deny each request in this test session.
  const denyRequests = session.defaultSession.setPermissionRequestHandler.bind(session.defaultSession);
  const denyChecks = session.defaultSession.setPermissionCheckHandler.bind(session.defaultSession);
  session.defaultSession.setPermissionRequestHandler = () => denyRequests((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler = () => denyChecks(() => false);
  session.defaultSession.setPermissionRequestHandler(null);
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const area = screen.getPrimaryDisplay().workArea;
  const scene = new BrowserWindow({ x: area.x + 40, y: area.y + 40, width: 600, height: 400,
    frame: false, show: true, alwaysOnTop: true, backgroundColor: '#194339', webPreferences: { sandbox: true } });
  await scene.loadURL('data:text/html,' + encodeURIComponent('<body style="background:#194339;color:white;font:28px sans-serif">小录统一操作栏验收</body>'));
  if (synthetic) installSyntheticCapture();
  const discovery = new NativeClient();
  const capabilities = process.platform === 'darwin' ? await discovery.request('capabilities') : undefined;
  const sources = await discovery.request<CaptureSource[]>('sources');
  discovery.dispose();
  // Freeze read-only inventories at preflight so concurrent settings probes cannot
  // compete with this run's ScreenCaptureKit session. Capture/start/stop stay real.
  const request = NativeClient.prototype.request;
  NativeClient.prototype.request = async function<T>(command: string, extra = {}): Promise<T> {
    if (command === 'sources') return structuredClone(sources) as T;
    if (command === 'capabilities') return structuredClone(capabilities) as T;
    if (command === 'live-applications' || command === 'microphone-devices') return [] as T;
    return request.call(this, command, extra) as Promise<T>;
  };
  report.inventory = synthetic ? 'Synthetic source and media' : 'Real preflight snapshot; unused media-device inventory disabled';
  const source = sources.find(value => value.kind === 'screen' && value.bounds && area.x >= value.bounds.x && area.x < value.bounds.x + value.bounds.width);
  assert.ok(source?.bounds);
  const scale = source.width / source.bounds.width;
  const preferences = { version: 1, recording: { cameraEnabled: false, microphoneEnabled: false, systemAudio: synthetic, fps: 30,
    resolution: '1080p', mode: 'region', screenSourceId: source.id, region: { sourceId: source.id,
      crop: { x: Math.round((scene.getBounds().x - source.bounds.x) * scale), y: Math.round((scene.getBounds().y - source.bounds.y) * scale),
        width: Math.round(600 * scale), height: Math.round(400 * scale) } } } };
  const seed = path.join(output, 'seed-preload.cjs');
  await fs.writeFile(seed, `if (location.protocol === 'frameflow:' && location.search === '?overlay=launcher') {
    for (const key of Object.keys(localStorage)) if (key.startsWith('frameflow.appPreferences.v2.')) localStorage.removeItem(key);
    localStorage.setItem('frameflow.appPreferences.v1', ${JSON.stringify(JSON.stringify(preferences))}); }`);
  session.defaultSession.registerPreloadScript({ type: 'frame', filePath: seed });
  // The development carrier already has capture permission. Keep its identity for this
  // isolated source run; installed-app identity and signing require package acceptance.
  report.captureIdentity = app.getName();
  if (!synthetic) app.setName = () => {};
  await import('./main');
  const launcher = await until(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('?overlay=launcher')),
    Boolean, 'production launcher');
  assert.ok(launcher);
  await until(() => launcher.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="开始录制"]:not(:disabled)')`), Boolean, 'ready start');
  assert.equal(launcher.getBounds().width, Math.min(1120, area.width), 'Legacy launcher width migrates to the current width');
  const originalId = launcher.id;
  const originalBounds = launcher.getBounds();
  await saveScreenshot(launcher, 'before-start');
  for (const demo of [false, true]) {
    if (demo) {
      await launcher.webContents.executeJavaScript(`document.querySelector('button[aria-label="更多设置"]').click()`);
      // Enable through the production menu IPC; intercept only its native popup presentation.
      const { Menu } = await import('electron');
      const popup = Menu.prototype.popup;
      Menu.prototype.popup = function () { this.items.find(item => item.label === '演示模式')!.click(); };
      await launcher.webContents.executeJavaScript('window.demo.menu()');
      Menu.prototype.popup = popup;
      await launcher.webContents.executeJavaScript(`document.querySelector('button[aria-label="收起设置"]').click()`);
    }
    console.log('Starting capture', { demo, synthetic });
    await button(launcher, '开始录制');
    await until(() => launcher.webContents.executeJavaScript(`!!document.querySelector('.session-status time') &&
      !!document.querySelector('button[aria-label="停止并编辑"]:not(:disabled)')`), Boolean, 'recording controls', 20000);
    assert.equal(launcher.id, originalId);
    assert.deepEqual(launcher.getBounds(), originalBounds);
    assert.equal(launcher.isVisible(), true);
    assert.equal(BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().endsWith('?overlay=toolbar')).length, 0);
    assert.equal((await launcher.webContents.executeJavaScript('window.whiteboard.snapshot()')).available, true);
    if (synthetic) {
      await button(launcher, '系统声音静音');
      await until(() => launcher.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="取消系统声音静音"]')`), Boolean, 'muted');
      await button(launcher, '取消系统声音静音');
      await until(() => launcher.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="系统声音静音"]')`), Boolean, 'unmuted');
    }
    await launcher.webContents.executeJavaScript(`document.querySelector('main').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))`);
    await delay(250);
    const buttons = await layout(launcher);
    assert.ok(buttons.every((value: { fits: boolean }) => value.fits), JSON.stringify(buttons));
    await saveScreenshot(launcher, demo ? 'demo-recording' : 'recording');
    await button(launcher, '更多设置');
    await until(() => launcher.getBounds().height > originalBounds.height, Boolean, 'expanded settings');
    await delay(250);
    await button(launcher, '收起设置');
    await until(() => launcher.getBounds().height === originalBounds.height, Boolean, 'closed settings');
    await launcher.webContents.executeJavaScript(`document.querySelector('main').dispatchEvent(new PointerEvent('pointerout', { bubbles: true })); window.dispatchEvent(new Event('blur'));`);
    await until(() => launcher.webContents.executeJavaScript(`!!document.querySelector('.session-toolbar.is-compact')`), Boolean, 'collapsed controls');
    await saveScreenshot(launcher, demo ? 'demo-collapsed' : 'collapsed');
    const nativePresentation = await inspectNativePresentation(launcher);
    (report.scenarios as unknown[]).push({ demo, stage: 'compact', nativePresentation });
    if (nativePresentation) {
      assert.equal(nativePresentation.controlsCovered, true, 'Native window region must contain the rendered toolbar and stop button');
      assert.equal(nativePresentation.stopHitTest, true, 'Windows hit testing must reach the compact stop button');
    }
    await button(launcher, '展开操作栏');
    await until(() => launcher.webContents.executeJavaScript(`!!document.querySelector('.session-toolbar')`), Boolean, 'expanded controls');
    await launcher.webContents.executeJavaScript(`document.querySelector('main').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))`);
    assert.deepEqual(launcher.getBounds(), originalBounds);
    if (demo) {
      for (let switchIndex = 0; switchIndex < 2; switchIndex++) {
        const { Menu } = await import('electron');
        const popup = Menu.prototype.popup;
        Menu.prototype.popup = function () { this.items[1].click(); };
        await launcher.webContents.executeJavaScript('window.demo.menu()'); Menu.prototype.popup = popup;
        await delay(400);
      }
    }
    await button(launcher, '停止并编辑');
    const editor = await until(() => BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === 'frameflow://app/index.html' && window.isVisible()),
      Boolean, 'saved project editor', 20000);
    assert.ok(editor);
    const list = await editor.webContents.executeJavaScript('window.studio.listProjects()');
    const files = await fs.readdir(projects);
    assert.ok(files.some(name => /^[0-9a-f-]{36}$/.test(name)));
    (report.scenarios as unknown[]).push({ demo, sameWindow: true, sameBounds: true, legacyWidthMigrated: true,
      recordingControlsFit: true, compactExpanded: true, savedEditorVisible: true, buttons, projects: list });
    await editor.webContents.executeJavaScript('window.studio.openRecorder()');
    await until(() => launcher.isVisible(), Boolean, 'return to the same launcher');
    await until(() => launcher.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="开始录制"]:not(:disabled)')`), Boolean, 'ready after stop');
    assert.equal(launcher.id, originalId);
    assert.deepEqual(launcher.getBounds(), originalBounds);
  }
  await saveScreenshot(launcher, 'returned');
  report.result = 'PASS';
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await launcher.webContents.executeJavaScript('window.recorder.quit()');
}
run().catch(async error => {
  report.result = 'FAIL'; report.error = error.stack ?? String(error);
  const launcher = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('?overlay=launcher'));
  if (launcher) {
    report.context = await launcher.webContents.executeJavaScript(`({ alerts: [...document.querySelectorAll('[role="alert"]')].map(element => element.textContent),
      preferences: localStorage.getItem('frameflow.appPreferences.v1'), keys: Object.keys(localStorage).filter(key => key.startsWith('frameflow.appPreferences.v2.')) })`).catch(() => undefined);
    await saveScreenshot(launcher, 'failure').catch(() => {});
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  await launcher?.webContents.executeJavaScript('window.recorder.quit()').catch(() => {});
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(1);
});
