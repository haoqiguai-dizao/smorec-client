/** Isolated native preview-exclusion and production export; no physical camera, audio or user projects. */
import { app, BrowserWindow, dialog, ipcMain, screen, session } from 'electron';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { NativeClient } from './services/native-client';
import { ProjectStore } from './services/projects';
import { Exporter } from './services/exporter';
import { ExportRenderer } from './services/export-renderer';
import { installProtocol } from './services/protocol';
import { ffmpegPath, probeMedia } from './services/ffmpeg';
import { bindCameraCapturePreparation, prepareIndependentCamera, protectIndependentCamera } from './services/demo/camera-policy';
import { DEFAULT_STYLE } from '../shared/constants';
import { RecordingHud } from './services/recording-hud';
import { RecordingController } from './services/recording';
import { installToolbarPresentation } from './services/toolbar-presentation';
import { setWindowInputRegions } from './services/platform/window-regions';
import type { CaptureSource, NativeRecordingResult, Project } from '../shared/types';

const root = process.env.XIAOLU_CAMERA_VERIFY_ROOT!, output = path.join(root, 'output/camera-zoom-20261010');
(app as typeof app & { setAppPath(value: string): void }).setAppPath(root);
app.setPath('userData', path.join(output, 'profile'));
app.on('window-all-closed', () => {});
const native = new NativeClient();
native.executable = () => path.join(output, 'swift-build/debug/XiaoLu.Capture');
let renderer: ExportRenderer | undefined, exporter: Exporter | undefined;
const report: Record<string, unknown> = { scope: 'synthetic camera; local native screen filter and production MP4 export' };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function encode(args: string[]): Buffer {
  const run = spawnSync(ffmpegPath(), ['-nostdin', '-v', 'error', ...args], { maxBuffer: 4 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr.toString()); return run.stdout;
}
function pixel(file: string, time: number, x: number, y: number): number[] {
  return [...encode(['-ss', String(time), '-i', file, '-vf', `crop=2:2:${x}:${y},scale=1:1,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'])];
}
async function cleanup() {
  await renderer?.dispose(); await exporter?.dispose(); await native.shutdownGracefully(); native.dispose();
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_a, _b, accept) => accept(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  await fs.mkdir(output, { recursive: true });
  const projects = new ProjectStore({ root: () => path.join(output, 'projects') });
  await projects.initialize(); installProtocol(projects);
  const removePresentation = installToolbarPresentation({ ipcMain, setRegions: setWindowInputRegions,
    resolveWindow: event => BrowserWindow.fromWebContents(event.sender) ?? undefined });
  ipcMain.handle('whiteboard:snapshot', () => ({ session: 'fixture', available: false, visible: false, events: [] }));
  let release!: () => void, preparing = false;
  const unbindReadiness = bindCameraCapturePreparation(() => {
    preparing = true; return new Promise<void>(resolve => { release = resolve; });
  });
  const hud = new RecordingHud({ onStop() {}, onAction() {}, onPreviewRequest() {}, onPreviewSignal() {}, onCameraPlacement() {} });
  const controls = new RecordingController(native, projects).controls;
  const state = { ...controls.snapshot(), status: 'recording' as const, cameraAvailable: true, cameraVisible: true };
  hud.update(state);
  const hudWindow = BrowserWindow.getAllWindows().find(window => window.getTitle() === '小录摄像头')!;
  let loads = 0; hudWindow.webContents.on('did-finish-load', () => { ++loads; });
  for (let i = 0; i < 100 && !preparing; i++) await delay(50);
  assert.equal(preparing, true); assert.equal(hudWindow.isVisible(), false);
  hud.update(state); await delay(250); hud.update(state); await delay(250);
  assert.equal(loads, 1, 'A pending filter must not trigger repeated preview reloads');
  assert.equal(hudWindow.isVisible(), false);
  release(); for (let i = 0; i < 100 && !hudWindow.isVisible(); i++) await delay(50);
  assert.equal(hudWindow.isVisible(), true); unbindReadiness(); hud.dispose(); removePresentation(); report.hudReadiness = 'PASS';
  if (process.argv.includes('--hud-only')) {
    const previous = JSON.parse(await fs.readFile(path.join(output, 'native-export-report.json'), 'utf8'));
    Object.assign(report, previous, { hudReadiness: 'PASS' });
    await cleanup(); await fs.writeFile(path.join(output, 'native-export-report.json'), JSON.stringify(report, null, 2)); app.exit(0); return;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const scene = new BrowserWindow({ x: area.x + 40, y: area.y + 40, width: 800, height: 450,
    frame: false, show: false, alwaysOnTop: true, backgroundColor: '#194339', webPreferences: { sandbox: true } });
  await scene.loadURL('data:text/html,<body style="margin:0;background:%23194339;width:100vw;height:100vh"></body>');
  const preview = new BrowserWindow({ x: area.x + 540, y: area.y + 260, width: 150, height: 150,
    frame: false, show: false, alwaysOnTop: true, backgroundColor: '#f05078', webPreferences: { sandbox: true } });
  protectIndependentCamera(preview);
  await preview.loadURL('data:text/html,<title>Untrusted document title</title><body style="margin:0;background:%23f05078;width:100vw;height:100vh"></body>');
  assert.equal(preview.getTitle(), '小录摄像头');
  const capability = await native.request<{ screenPermission: boolean }>('capabilities');
  if (process.argv.includes('--export-only')) {
    const previous = JSON.parse(await fs.readFile(path.join(output, 'native-export-report.json'), 'utf8'));
    report.nativeCapture = previous.nativeCapture; report.nativePixel = previous.nativePixel;
  } else if (capability.screenPermission) {
    scene.showInactive(); await delay(300);
    const source = (await native.request<CaptureSource[]>('sources')).find(item => item.kind === 'screen' && item.bounds
      && area.x >= item.bounds.x && area.x < item.bounds.x + item.bounds.width)!;
    assert.ok(source?.bounds);
    const scale = source.width / source.bounds.width, directory = await fs.mkdtemp(path.join(output, 'native-recording-'));
    await fs.mkdir(directory, { recursive: true });
    const started = await native.request<{ cameraIndependent: boolean }>('start', { directory, options: {
      sourceId: source.id, systemAudio: false, microphone: false, inputRecording: false, fps: 30, resolution: '1080p',
      captureOwnApp: true, ownAppVisible: true, crop: { x: Math.round((scene.getBounds().x - source.bounds.x) * scale),
        y: Math.round((scene.getBounds().y - source.bounds.y) * scale),
        width: Math.round(800 * scale), height: Math.round(450 * scale) },
    } });
    assert.equal(started.cameraIndependent, true);
    preview.showInactive(); preview.moveTop(); await delay(600);
    const late = new BrowserWindow({ x: area.x + 190, y: area.y + 210, width: 140, height: 140,
      frame: false, show: false, alwaysOnTop: true, backgroundColor: '#f05078', webPreferences: { sandbox: true } });
    protectIndependentCamera(late);
    await late.loadURL('data:text/html,<body style="margin:0;background:%23f05078;width:100vw;height:100vh"></body>');
    const unbind = bindCameraCapturePreparation(async () => {
      const applied = await native.request<{ cameraIndependent: boolean }>('recording-demo', { visible: true });
      assert.equal(applied.cameraIndependent, true);
    });
    await prepareIndependentCamera(late); unbind(); late.showInactive(); late.moveTop(); await delay(700);
    const result = await native.request<NativeRecordingResult>('stop');
    const file = path.join(directory, result.video);
    const x = Math.floor(result.width * .7), y = Math.floor(result.height * .65);
    const rgb = pixel(file, result.duration / 2, x, y);
    assert.ok(rgb[1] > rgb[0] + 20 && rgb[1] > rgb[2] + 5, `Preview must be excluded even when first shown after capture: ${rgb}`);
    const lateRgb = pixel(file, result.duration - .2, Math.floor(result.width * .25), Math.floor(result.height * .55));
    assert.ok(lateRgb[1] > lateRgb[0] + 20 && lateRgb[1] > lateRgb[2] + 5, `Late-created preview must be excluded before display: ${lateRgb}`);
    late.destroy(); report.nativeCapture = 'PASS'; report.nativePixel = rgb; report.latePreviewPixel = lateRgb;
  } else report.nativeCapture = 'BLOCKED_EXISTING_SCREEN_PERMISSION';
  preview.hide(); scene.hide();
  const id = randomUUID(), directory = path.join(output, 'projects', id); await fs.mkdir(directory, { recursive: true });
  encode(['-f', 'lavfi', '-i', 'color=c=0x194339:s=640x360:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(directory, 'screen.mp4')]);
  encode(['-f', 'lavfi', '-i', 'color=c=0xf05078:s=160x160:r=30:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', path.join(directory, 'camera.mp4')]);
  const project: Project = { id, name: '演示人物分层输出验收', createdAt: new Date().toISOString(), duration: 4, width: 640, height: 360, fps: 30,
    media: { screen: 'screen.mp4', camera: 'camera.mp4' }, cursor: [], clips: [{ id: 'clip', start: 0, end: 4 }],
    zooms: [{ id: 'zoom', start: 0, end: 4, x: .25, y: .4, scale: 2.5 }],
    demoCapture: [{ start: 0, end: 4, camera: 'independent' }],
    camera: { offset: 0, enabled: true, size: .3, position: 'bottom-right', shape: 'square', mirror: false, shrinkOnZoom: true },
    style: { ...DEFAULT_STYLE, padding: 0, radius: 0, showCursor: false }, audio: { system: 0, microphone: 0 } };
  await fs.writeFile(path.join(directory, 'project.json'), JSON.stringify({ version: 10, project, embeddedAudio: false }));
  await projects.load(id);
  exporter = new Exporter(projects); renderer = new ExportRenderer(exporter, projects);
  const samples: unknown[] = [];
  for (const [name, camera] of [['small', undefined], ['large', { visible: true, x: .9, y: .9, size: .65 }], ['hidden', { visible: false }]] as const) {
    const value = { ...project, ...(camera ? { compositions: [{ id: 'local', start: 0, end: 4, screen: 'recording' as const, camera }] } : {}) };
    const destination = path.join(output, `export-${name}.mp4`);
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: destination })) as typeof dialog.showSaveDialog;
    assert.equal(await renderer.start(scene, value), destination);
    const media = await probeMedia(destination); assert.equal(media.width, 640); assert.equal(media.height, 360);
    assert.ok(Math.abs(media.duration - 4) < .1);
    const corner = pixel(destination, 2, 610, 330), body = pixel(destination, 2, 520, 260);
    assert.equal(corner[0] > corner[1] + 80, name !== 'hidden');
    assert.equal(body[0] > body[1] + 80, name === 'large');
    samples.push({ name, corner, body, media });
  }
  report.encodedExport = 'PASS'; report.samples = samples;
  await cleanup(); await fs.writeFile(path.join(output, 'native-export-report.json'), JSON.stringify(report, null, 2)); app.exit(0);
}).catch(async error => {
  report.error = error.stack ?? String(error);
  await cleanup().catch(() => {}); await fs.writeFile(path.join(output, 'native-export-report.json'), JSON.stringify(report, null, 2)); app.exit(1);
});
