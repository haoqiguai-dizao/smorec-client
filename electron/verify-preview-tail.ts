/** Synthetic screen/audio/camera only: exercises the real preview hook and WebCodecs export. */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdirSync, promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ProjectStore } from './services/projects';
import { Exporter } from './services/exporter';
import { ffmpegPath, probeMedia } from './services/ffmpeg';

const directory = path.resolve(process.env.FRAMEFLOW_SYNTHETIC_OUTPUT ?? 'output/preview-tail-verification');
const profile = path.join(directory, 'profile');
mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');

app.whenReady().then(async () => {
  await fs.mkdir(directory, { recursive: true });
  const store = new ProjectStore(); store.root = () => directory;
  const location = await store.createDirectory();
  const run = (args: string[]) => {
    const result = spawnSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr.toString());
  };
  run(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=1', '-c:v', 'libx264', path.join(location.directory, 'screen.mp4')]);
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', path.join(location.directory, 'system.wav')]);
  run(['-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30:duration=2', '-c:v', 'libvpx', path.join(location.directory, 'camera.webm')]);
  await fs.writeFile(path.join(location.directory, 'cursor.json'), '[]');
  const project = await store.acceptRecording({ directory: location.directory, duration: 2, width: 320, height: 180,
    video: 'screen.mp4', cursor: 'cursor.json', systemAudio: 'system.wav' },
  { sourceId: 'synthetic', fps: 30, systemAudio: true, microphone: false }, location.id, location.directory, { filename: 'camera.webm', offset: 0 });
  project.style.showCursor = false; project.style.padding = 0; project.zooms = [];
  await store.save(project);
  const files = new Map([
    ['/screen.mp4', path.join(location.directory, 'screen.mp4')], ['/system.wav', path.join(location.directory, 'system.wav')],
    ['/camera.webm', path.join(location.directory, 'camera.webm')], ['/harness.js', path.join(directory, 'harness.js')],
  ]);
  const server = createServer(async (request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<div id="app"></div><script src="/harness.js"></script>'); return; }
    const filename = files.get(request.url ?? '');
    if (!filename) { response.writeHead(404).end(); return; }
    const data = await fs.readFile(filename), range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.mp4') ? 'video/mp4' : filename.endsWith('.webm') ? 'video/webm' : 'audio/wav');
    response.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const start = Number(range[1]), end = Math.min(Number(range[2] || data.length - 1), data.length - 1);
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
      response.end(data.subarray(start, end + 1));
    } else { response.setHeader('Content-Length', data.length); response.end(data); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const exportedPath = path.join(directory, 'tail-export.mp4');
  dialog.showSaveDialog = (async () => ({ canceled: false, filePath: exportedPath })) as typeof dialog.showSaveDialog;
  const exporter = new Exporter(store);
  const preload = path.join(directory, 'preload.cjs');
  await fs.writeFile(preload, `const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('previewTestApi', { project: () => ipcRenderer.invoke('preview:project'), studio: {
getStatus: () => ipcRenderer.invoke('preview:status'), cancelExportPreparation: () => ipcRenderer.invoke('preview:export-preparation-cancel'),
exportStart: (...args) => ipcRenderer.invoke('preview:export-start', ...args), exportAppend: (...args) => ipcRenderer.invoke('preview:export-append', ...args),
exportFinish: (...args) => ipcRenderer.invoke('preview:export-finish', ...args), exportCancel: (...args) => ipcRenderer.invoke('preview:export-cancel', ...args) } });`);
  const window = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, backgroundThrottling: false, offscreen: true } });
  window.webContents.setAudioMuted(true);
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  ipcMain.handle('preview:project', () => ({ ...project, media: { screen: `${origin}/screen.mp4`, systemAudio: `${origin}/system.wav`, camera: `${origin}/camera.webm` } }));
  ipcMain.handle('preview:status', () => ({ platform: process.platform }));
  ipcMain.handle('preview:export-preparation-cancel', () => exporter.cancelPreparation());
  ipcMain.handle('preview:export-start', (_, active, settings) => exporter.start(window, active, settings));
  ipcMain.handle('preview:export-append', (_, id, packet) => exporter.append(id, packet));
  ipcMain.handle('preview:export-finish', (_, id) => exporter.finish(id));
  ipcMain.handle('preview:export-cancel', (_, id) => exporter.cancel(id));
  await window.loadURL(origin);
  const execute = (code: string) => window.webContents.executeJavaScript(code);
  async function waitFor(expression: string) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await execute(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out: ${expression}; ${JSON.stringify(await execute('({...previewTail.state(), fingerprint:undefined})'))}`);
  }
  await waitFor('window.previewTail?.ready()');
  await execute('previewTail.play()');
  await waitFor('previewTail.state().source > 1.1');
  const earlyTail = await execute('previewTail.state()');
  await waitFor('previewTail.state().source > 1.5');
  const tail = await execute('previewTail.state()');
  assert.equal(tail.playing, true); assert.ok(tail.screen.ended); assert.ok(tail.audio.time > 1.35 && !tail.audio.paused);
  assert.ok(tail.camera.time > 1.35 && !tail.camera.paused); assert.equal(tail.fingerprint, earlyTail.fingerprint);
  await execute('previewTail.pause()');
  const paused = await execute('previewTail.state()');
  await new Promise(resolve => setTimeout(resolve, 180));
  const held = await execute('previewTail.state()'); assert.ok(Math.abs(held.source - paused.source) < .03);
  await execute('previewTail.play()'); await waitFor('previewTail.state().source > 1.8');
  assert.ok((await execute('previewTail.state()')).screen.time > .95, 'Tail resume must not restart the screen');
  await waitFor('!previewTail.state().playing');
  assert.equal((await execute('previewTail.state()')).currentTime, 2);
  await execute('previewTail.seek(1.5)'); await waitFor('Math.abs(previewTail.state().source - 1.5) < .01');
  await execute('previewTail.play()'); await waitFor('previewTail.state().source > 1.7');
  const sought = await execute('previewTail.state()'); assert.ok(sought.screen.time > .95 && sought.audio.time > 1.55);
  await execute('previewTail.pause(); previewTail.clips([{id:"tail",start:1.5,end:1.8},{id:"back",start:.1,end:.5}])');
  await new Promise(resolve => setTimeout(resolve, 40));
  await execute('previewTail.seek(0); previewTail.play()');
  await waitFor('previewTail.state().source > .15 && previewTail.state().source < .5 && previewTail.state().currentTime > .3');
  const cut = await execute('previewTail.state()'); assert.ok(cut.screen.time < .5 && cut.audio.time < .6 && cut.playing);
  await execute('previewTail.pause(); previewTail.clips([{id:"whole",start:0,end:2}])');
  await new Promise(resolve => setTimeout(resolve, 40));
  await execute('previewTail.seek(0); void previewTail.play(); previewTail.seek(1.5)');
  await waitFor('previewTail.state().playing && previewTail.state().source > 1.65');
  assert.deepEqual((await execute('previewTail.state()')).errors, []);
  await execute('previewTail.pause(); previewTail.clips([{id:"whole",start:0,end:2}])');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(await execute('previewTail.export()'), exportedPath);
  const info = await probeMedia(exportedPath);
  assert.ok(Math.abs(info.duration - 2) < .05 && info.hasAudio);
  assert.deepEqual((await execute('previewTail.state()')).errors, []);
  const report = { result: 'PASS', screenDuration: tail.screen.duration, presentationDuration: 2,
    finalFrameHeld: true, tailAudioAndCameraContinue: true, pauseResume: true, tailSeek: true, backwardCut: true, pendingPlaySeekRace: true, exportDuration: info.duration, exportHasAudio: info.hasAudio };
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); window.destroy(); server.close(); app.exit(0);
}).catch((error: unknown) => { console.error(error); app.exit(1); });
