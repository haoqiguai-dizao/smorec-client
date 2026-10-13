import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectStore } from '../electron/services/projects';
import { MicrophoneSession } from '../electron/services/microphone-session';
import { Exporter } from '../electron/services/exporter';
import { installProtocol } from '../electron/services/protocol';
import { disposeMicrophoneEffects } from '../electron/services/microphone-effects';
import { disposeProjectAudio } from '../electron/services/project-audio';
import { audioCacheManager, disposeAudioCache } from '../electron/services/audio-cache';
import { ffmpegPath } from '../electron/services/ffmpeg';
import { writeSyntheticWave } from './fixtures/microphone-audio';
import { nativeTrialEvents } from './fixtures/microphone-native-session';
import { exportCachePaths } from './fixtures/microphone-export-cache-spy';
import { verifyMicrophonePreparationRace } from './fixtures/microphone-preparation-race';
import { verifyMicrophoneStopFailure } from './fixtures/microphone-stop-failure';
import { DEFAULT_STYLE } from '../shared/constants';
import type { Project, ExportSettings } from '../shared/types';

const directory = process.env.MICROPHONE_INTEGRATION_DIRECTORY!;
if (!directory) throw new Error('Isolated test directory required');
app.setPath('userData', path.join(directory, 'profile')); app.setPath('temp', directory);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const projects = new ProjectStore({ root: () => path.join(directory, 'projects') });
const microphones = new MicrophoneSession(projects), exporter = new Exporter(projects);
const command = promisify(execFile);
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
let project: Project, raw: string, originalHash: string, window: BrowserWindow;
const calls: { method: string; at: number }[] = [];

async function createFixture() {
  const created = await projects.createDirectory(); raw = path.join(created.directory, 'microphone.wav');
  await writeSyntheticWave(raw, 48000, 1, 576000, frame => (.025 + .14 * (Math.floor(frame / 12000) % 2)) * Math.sin(frame * Math.PI * 2 * 180 / 48000));
  originalHash = await hash(raw);
  await command(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x314751:s=320x180:r=30:d=12',
    '-an', '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-threads', '1', '-f', 'ivf', path.join(directory, 'frames.ivf')], { windowsHide: true });
  await command(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(directory, 'frames.ivf'), '-c', 'copy', path.join(created.directory, 'screen.webm')], { windowsHide: true });
  const stored: Project = { id: created.id, name: 'Synthetic microphone integration', createdAt: new Date().toISOString(), duration: 12,
    width: 320, height: 180, fps: 30, media: { screen: 'screen.webm', microphone: 'microphone.wav' }, cursor: [], zooms: [],
    clips: [{ id: 'synthetic-clip', start: 0, end: 12 }], style: { ...DEFAULT_STYLE, showCursor: false }, audio: { system: 0, microphone: .65 } };
  await fs.writeFile(path.join(created.directory, 'project.json'), JSON.stringify({ version: 1, project: stored, embeddedAudio: false }));
  projects.endWrite(created.id); project = await projects.load(created.id);
}
async function exportProject(value: Project) {
  const destination = path.join(directory, 'microphone-export.mp4');
  const previousDialog = dialog.showSaveDialog;
  dialog.showSaveDialog = (async () => ({ canceled: false, filePath: destination })) as typeof dialog.showSaveDialog;
  try {
    const session = await exporter.start(window, value, { width: 320, height: 180, fps: 30, frames: 360 });
    if (!session) throw new Error('Export was canceled');
    const frames = await fs.readFile(path.join(directory, 'frames.ivf'));
    for (let offset = 32; offset < frames.length;) {
      const size = frames.readUInt32LE(offset), packet = frames.subarray(offset, offset + 12 + size);
      await exporter.append(session.id, packet.buffer.slice(packet.byteOffset, packet.byteOffset + packet.byteLength));
      offset += packet.length;
    }
    await exporter.finish(session.id);
    const { stderr } = await command(ffmpegPath(), ['-hide_banner', '-i', destination, '-f', 'null', '-'], { windowsHide: true });
    return { destination, cachePath: exportCachePaths.at(-1), bytes: (await fs.stat(destination)).size, hasAudio: /Audio: aac/.test(stderr) };
  } finally { dialog.showSaveDialog = previousDialog; }
}

async function verifyExportCacheLease(value: Project) {
  await microphones.suspend();
  const manager = audioCacheManager(); await manager.clear();
  const originalDialog = dialog.showSaveDialog;
  dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path.join(directory, 'canceled-cache-export.mp4') })) as typeof dialog.showSaveDialog;
  try {
    const session = await exporter.start(window, value, { width: 320, height: 180, fps: 30, frames: 360 }); assert.ok(session);
    try {
      const active = await manager.clear(); assert.equal(active.freedBytes, 0); assert.ok(active.snapshot.inUseBytes > 0);
      await exporter.cancel(session.id);
      assert.equal((await manager.state()).inUseBytes, 0);
      const canceled = await manager.clear(); assert.ok(canceled.freedBytes > 0);
      const completed = await exportProject(value); assert.ok(completed.hasAudio && completed.bytes > 1000);
      assert.equal((await manager.state()).inUseBytes, 0);
      const finished = await manager.clear(); assert.ok(finished.freedBytes > 0); assert.equal(await hash(raw), originalHash);
      return { protectedWhileEncoding: active.snapshot.inUseBytes, releasedAfterCancel: canceled.freedBytes,
        releasedAfterFinish: finished.freedBytes, completedExport: completed.destination, sourceUnchanged: true };
    } finally { if (exporter.isActive()) await exporter.dispose(); }
  } finally { dialog.showSaveDialog = originalDialog; }
}

async function dualProject(): Promise<Project> {
  const created = await projects.createDirectory(), previous = projects.get(project.id);
  await fs.copyFile(path.join(previous.directory, 'screen.webm'), path.join(created.directory, 'screen.webm'));
  await fs.copyFile(raw, path.join(created.directory, 'microphone.wav'));
  await writeSyntheticWave(path.join(created.directory, 'system.wav'), 48000, 2, 576000, () => 0);
  const stored = { ...previous.project, id: created.id, media: { screen: 'screen.webm', microphone: 'microphone.wav', systemAudio: 'system.wav' },
    audio: { system: 1, microphone: 1 } };
  await fs.writeFile(path.join(created.directory, 'project.json'), JSON.stringify({ version: 1, project: stored, embeddedAudio: false }));
  projects.endWrite(created.id); return projects.load(created.id);
}

app.whenReady().then(async () => {
  await createFixture();
  installProtocol(projects, 'file:///', token => microphones.media(token), undefined, token => microphones.mediaSignal(token));
  ipcMain.handle('microphone-integration', async (_event, method: string, ...args: unknown[]) => {
    calls.push({ method, at: Date.now() });
    switch (method) {
      case 'project': return project;
      case 'dualProject': return dualProject();
      case 'startTrial': return microphones.startTrial(args[0]);
      case 'finishTrial': return microphones.finishTrial(args[0]);
      case 'cancelTrial': return microphones.cancelTrial(args[0]);
      case 'processTrial': return microphones.processTrial(args[0], args[1]);
      case 'prepareProject': return microphones.prepareProject(args[0], args[1]);
      case 'prepareAudio': return microphones.prepareAudio(args[0], args[1]);
      case 'cancelPreparation': return microphones.cancelPreparation();
      case 'releaseAudio': return microphones.releaseMedia(args[0]);
      case 'cacheState': return audioCacheManager().state();
      case 'cacheClear': return audioCacheManager().clear();
      case 'verifyExportCacheLease': return verifyExportCacheLease(args[0] as Project);
      case 'saveProject': await projects.save(args[0]); return projects.load((args[0] as Project).id);
      case 'resolveUrl': return microphones.media(new URL(String(args[0])).pathname.slice(1));
      case 'export': return exportProject(args[0] as Project);
      case 'minimize': window.minimize(); return true;
      case 'windowState': return { minimized: window.isMinimized(), visible: window.isVisible() };
      case 'exportStart': {
        const destination = path.join(directory, 'background-export.mp4'), original = dialog.showSaveDialog;
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: destination })) as typeof dialog.showSaveDialog;
        try { return await exporter.start(window, args[0] as Project, args[1] as ExportSettings); }
        finally { dialog.showSaveDialog = original; }
      }
      case 'exportAppend': return exporter.append(String(args[0]), args[1] as ArrayBuffer);
      case 'exportFinish': return exporter.finish(String(args[0]));
      case 'exportCancel': return exporter.cancel(String(args[0]));
      case 'cancelExportPreparation': return exporter.cancelPreparation();
      case 'inspectBackgroundExport': {
        const file = path.join(directory, 'background-export.mp4');
        const { stderr } = await command(ffmpegPath(), ['-hide_banner', '-i', file, '-f', 'null', '-'], { windowsHide: true });
        return { bytes: (await fs.stat(file)).size, hasAudio: /Audio: aac/.test(stderr), decoded: stderr.includes('frame=') };
      }
      case 'backend': return { calls, nativeTrialEvents, originalHash, currentRawHash: await hash(raw), exportCachePaths,
        trialDirectories: (await fs.readdir(directory)).filter(name => name.startsWith('smorec-microphone-')),
        cacheFiles: await fs.readdir(path.join(directory, 'profile/cache/microphone-effects')).catch(() => []) };
      case 'suspend': await microphones.suspend(); return true;
      case 'cancelDuringPreparation': return verifyMicrophonePreparationRace(microphones);
      case 'stopFailure': return verifyMicrophoneStopFailure(microphones);
      default: throw new Error('Unknown test command');
    }
  });
  window = new BrowserWindow({ show: false, width: 640, height: 600, webPreferences: { offscreen: true,
    preload: path.join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  await window.loadFile(path.join(directory, 'harness.html'));
}).catch(async error => { await fs.writeFile(path.join(directory, 'startup-failure.txt'), error.stack ?? String(error)); app.exit(1); });
app.on('before-quit', () => { void microphones.suspend(); void exporter.dispose(); disposeMicrophoneEffects(); disposeProjectAudio(); disposeAudioCache(); });
