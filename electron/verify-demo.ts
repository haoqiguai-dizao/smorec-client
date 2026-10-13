/** Isolated real UI plus optional ScreenCaptureKit recording. No microphone or camera access. */
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session } from 'electron';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { RecordingController } from './services/recording';
import { NativeClient } from './services/native-client';
import { ProjectStore } from './services/projects';
import { installProtocol } from './services/protocol';
import { RecordingHud } from './services/recording-hud';
import { createDemoIntegration } from './services/demo/integration';
import { flushDiagnostics } from './services/diagnostics';
import { userPreferences } from './services/user-preferences';
import { installToolbarPresentation } from './services/toolbar-presentation';
import { setWindowInputRegions } from './services/platform/window-regions';
import { Exporter } from './services/exporter';
import { ExportRenderer } from './services/export-renderer';
import { probeMedia } from './services/ffmpeg';
import type { Project } from '../shared/types';

const root = process.env.XIAOLU_DEMO_ROOT!;
const output = path.join(root, 'output/demo-mode');
// Same test-only app-root override as scripts/electron-harness.cjs.
(app as typeof app & { setAppPath(value: string): void }).setAppPath(root);
app.setPath('userData', path.join(output, 'profile'));
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let native: NativeClient, hud: RecordingHud, demonstration: ReturnType<typeof createDemoIntegration>;
let scene: BrowserWindow;
const report: Record<string, unknown> = { ui: 'PENDING', capture: 'UNVERIFIED' };
async function waitFor(check: () => Promise<unknown> | unknown, label: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw Error(`Timed out: ${label}`);
}
async function cleanup(): Promise<void> {
  demonstration?.dispose(); hud?.dispose(); native?.dispose();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  await flushDiagnostics();
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_content, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await fs.mkdir(output, { recursive: true });
  const projects = new ProjectStore({ root: () => path.join(output, 'projects') });
  await projects.initialize(); installProtocol(projects);
  installToolbarPresentation({ ipcMain, setRegions: setWindowInputRegions,
    resolveWindow: event => BrowserWindow.fromWebContents(event.sender) ?? undefined });
  ipcMain.handle('whiteboard:snapshot', () => ({ session: 'fixture', available: false, visible: false, events: [] }));
  native = new NativeClient();
  const recording = new RecordingController(native, projects);
  hud = new RecordingHud({ onStop: () => recording.stop().then(() => {}),
    onAction: action => recording.controls.control(action), onPreviewRequest: () => {},
    onPreviewSignal: () => {}, onCameraPlacement: () => {} });
  demonstration = createDemoIntegration({ recording, live: () => { throw Error('No live session'); },
    trusted: event => event.sender === hud.getToolbarWindow()?.webContents && event.senderFrame === event.sender.mainFrame,
    editor: async () => { scene.show(); }, presentationHidden: hidden => hud.setPresentationHidden(hidden), changed: () => {} });
  demonstration.install(); recording.demoOptions = demonstration.captureOptions;
  const area = screen.getPrimaryDisplay().workArea;
  scene = new BrowserWindow({ x: area.x + 40, y: area.y + 40, width: 1000, height: 600,
    frame: false, show: true, alwaysOnTop: true, backgroundColor: '#194339', webPreferences: { sandbox: true } });
  await scene.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="background:#194339;color:white;font:40px sans-serif;margin:50px">小录 · 演示模式验收<p id="tick">0</p><script>setInterval(()=>tick.textContent=Date.now(),100)</script>'));
  const exportProject = async (project: Project) => {
    const destination = path.join(output, 'demo-export.mp4');
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: destination })) as typeof dialog.showSaveDialog;
    const exporter = new Exporter(projects), renderer = new ExportRenderer(exporter, projects);
    assert.equal(await renderer.start(scene, project), destination);
    const media = await probeMedia(destination);
    assert.equal(media.width, project.width); assert.equal(media.height, project.height);
    assert.ok(Math.abs(media.duration - project.duration) < .1);
    report.export = 'PASS'; report.exportPath = destination; report.exportDuration = media.duration;
    await renderer.dispose(); await exporter.dispose();
  };
  if (process.argv.includes('--export-only')) {
    Object.assign(report, JSON.parse(await fs.readFile(path.join(output, 'ui-report.json'), 'utf8')));
    await exportProject(await projects.load(String(report.projectId)));
    await cleanup(); await fs.writeFile(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2)); app.exit(0); return;
  }
  demonstration.controller.configure(true);
  demonstration.prepare('record', 'screen:fixture'); demonstration.controller.started();
  hud.update({ ...recording.controls.snapshot(), status: 'recording', startedAtUnixMs: Date.now() });
  await waitFor(async () => {
    const toolbar = hud.getToolbarWindow();
    return toolbar && await toolbar.webContents.executeJavaScript(`!!document.querySelector('button[aria-label="演示 · 界面入画"]')`);
  }, 'Demo button in production toolbar');
  const toolbar = hud.getToolbarWindow()!;
  toolbar.webContents.on('console-message', (_event, level, message) => {
    if (level >= 3) process.stderr.write(`Renderer: ${message}\n`);
  });
  const originalPopup = Menu.prototype.popup;
  let menuOpened = false;
  Menu.prototype.popup = function () { menuOpened = this.items.some(item => item.label === '演示模式'); };
  await toolbar.webContents.executeJavaScript(`document.querySelector('button[aria-label="演示 · 界面入画"]').click()`);
  await waitFor(() => menuOpened, 'trusted demo button opens menu'); Menu.prototype.popup = originalPopup;
  const layout = await toolbar.webContents.executeJavaScript(`(() => {
    const surface = document.querySelector('[data-toolbar-surface]').getBoundingClientRect();
    return [...document.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => {
      const bounds = button.getBoundingClientRect(); return { label: button.getAttribute('aria-label'),
        fits: bounds.left >= surface.left && bounds.right <= surface.right + 1 }; }); })()`);
  assert.ok(layout.every((button: { fits: boolean }) => button.fits), JSON.stringify(layout));
  await fs.writeFile(path.join(output, 'toolbar.png'), (await toolbar.webContents.capturePage()).toPNG());
  demonstration.controller.end(); hud.update(recording.controls.snapshot());
  report.ui = 'PASS'; report.toolbarLayout = layout;
  const capability = await native.request<{ screenPermission: boolean }>('capabilities');
  if (!capability.screenPermission) {
    report.capture = 'BLOCKED_PERMISSION'; report.reason = 'Native capture identity has no existing Screen Recording permission; no permission was changed';
  } else {
    const sources = await recording.sources();
    const source = sources.find(value => value.kind === 'screen' && value.bounds
      && area.x >= value.bounds.x && area.x < value.bounds.x + value.bounds.width)!;
    assert.ok(source?.bounds);
    const scale = source.width / source.bounds!.width;
    recording.prepareCapture = async () => {
      demonstration.prepare('record', source.id); hud.setCaptureBounds(source.bounds); return [];
    };
    recording.onState = state => { demonstration.status('record', state.status); hud.update(recording.controls.snapshot()); };
    demonstration.controller.configure(true);
    await recording.start({ sourceId: source.id, systemAudio: false, microphone: false, fps: 30, resolution: '1080p',
      crop: { x: Math.round((scene.getBounds().x - source.bounds!.x) * scale),
        y: Math.round((scene.getBounds().y - source.bounds!.y) * scale), width: Math.round(1000 * scale), height: Math.round(600 * scale) } });
    await delay(1300); await demonstration.controller.toggle();
    assert.equal(recording.state.status, 'recording'); await delay(1300);
    await demonstration.controller.toggle(); await delay(1300);
    assert.equal(scene.isVisible(), true, 'The test scene stays locally visible across filter switches');
    const project: Project = await recording.stop();
    assert.ok(project.demoCapture?.length === 2); assert.equal(demonstration.controller.state.enabled, false);
    const reopened = await projects.load(project.id); assert.deepEqual(reopened.demoCapture, project.demoCapture);
    report.capture = 'RECORDED'; report.projectId = project.id; report.duration = project.duration;
    report.demoCapture = project.demoCapture; report.directory = path.join(output, 'projects', project.id);
    await exportProject(reopened);
    report.requiresFrameVerification = true;
  }
  // New or re-shown app windows obey the same desktop hide/restore policy.
  demonstration.controller.configure(true); demonstration.prepare('record', 'screen:fixture'); demonstration.controller.started();
  recording.setDemoVisibility = async () => {};
  await demonstration.controller.toggleDesktop(); assert.equal(scene.isVisible(), false);
  const dialogWindow = new BrowserWindow({ width: 200, height: 100, show: false });
  dialogWindow.show(); scene.show();
  await waitFor(() => !dialogWindow.isVisible() && !scene.isVisible(), 'Re-shown and newly created windows stay hidden');
  await demonstration.controller.toggleDesktop();
  assert.equal(dialogWindow.isVisible(), true); assert.equal(scene.isVisible(), true);
  demonstration.controller.end(); dialogWindow.destroy(); report.desktopRestore = 'PASS';
  userPreferences.flush(); await cleanup();
  await fs.writeFile(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2)); app.exit(0);
}).catch(async error => {
  report.error = error.stack ?? String(error);
  await fs.writeFile(path.join(output, 'ui-report.json'), JSON.stringify(report, null, 2));
  await cleanup().catch(() => {}); app.exit(1);
});
