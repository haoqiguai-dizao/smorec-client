import { app, BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import ffmpeg from 'ffmpeg-static';
import { StreamWriter } from './services/streaming/writer';
import { watchPreviewVisibility } from './services/live/preview-visibility';
import { DEFAULT_STYLE } from '../shared/constants';
import { ORIGINAL_CAMERA_EFFECTS } from '../shared/camera-effects';
import { DEFAULT_STREAM_ENCODING, type StreamConnection } from '../shared/streaming';

const directory = path.resolve(process.env.FRAMEFLOW_SYNTHETIC_OUTPUT!);
app.setPath('userData', path.join(directory, 'profile'));
app.on('window-all-closed', () => {});
const run = promisify(execFile);
app.whenReady().then(async () => {
  assert.ok(ffmpeg);
  const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const file = path.join(directory, 'preview-output.flv');
  const receiver = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'warning', '-y', '-listen', '1', '-timeout', '20',
    '-i', `rtmp://127.0.0.1:${port}/live/owned-preview`, '-c', 'copy', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  let receiverLog = ''; receiver.stderr?.on('data', bytes => { receiverLog += bytes.toString(); });
  const receiverDone = new Promise(resolve => receiver.once('close', resolve));
  const failures: string[] = [], states: StreamConnection[] = [], windowStates: boolean[] = [];
  const writer = new StreamWriter({ executable: ffmpeg, profile: { ...DEFAULT_STREAM_ENCODING, resolution: '1080p',
    id: 'owned-preview', name: 'Owned preview test', server: `rtmp://127.0.0.1:${port}/live`, key: 'owned-preview' },
    changed: value => states.push(value), failed: error => failures.push(error.message) });
  let window: BrowserWindow | undefined, watcher: ReturnType<typeof watchPreviewVisibility> | undefined;
  try {
    await new Promise(resolve => setTimeout(resolve, 500)); await writer.start(1920, 1080, 30);
    const preload = path.join(directory, 'preload.cjs');
    await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('displayFixture',{
pull:()=>ipcRenderer.invoke('fixture:pull'),push:p=>ipcRenderer.invoke('fixture:push',p),window:a=>ipcRenderer.invoke('fixture:window',a),
visibility:cb=>{const fn=(_,v)=>cb(v);ipcRenderer.on('fixture:visible',fn);ipcRenderer.send('fixture:watch');return()=>ipcRenderer.removeListener('fixture:visible',fn)}});`);
    window = new BrowserWindow({ width: 760, height: 480, show: false, title: '小录预览隔离测试',
      webPreferences: { sandbox: true, preload, backgroundThrottling: false } });
    window.webContents.on('console-message', event => console.log(event.message));
    watcher = watchPreviewVisibility(window, visible => { windowStates.push(visible); window!.webContents.send('fixture:visible', visible); });
    let started = performance.now();
    const pixels = Buffer.alloc(1280 * 720 * 4);
    for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
      const offset = (y * 1280 + x) * 4;
      pixels[offset] = x % 256; pixels[offset + 1] = y % 256; pixels[offset + 2] = ((x >> 5) ^ (y >> 5)) & 1 ? 220 : 40; pixels[offset + 3] = 255;
    }
    let audioEnd = 0, frameTime = 0, outputFrames = 0;
    ipcMain.on('fixture:watch', () => watcher!.publish());
    ipcMain.handle('fixture:pull', () => {
      frameTime = (performance.now() - started) / 1000;
      const end = Math.ceil((frameTime + 1 / 30) * 48000);
      while (audioEnd < end) {
        const next = Math.min(end, audioEnd + 4800), pcm = Buffer.alloc((next - audioEnd) * 8);
        for (let i = audioEnd; i < next; i++) {
          const tone = Math.sin(i * Math.PI * 2 * 440 / 48000) * .1;
          pcm.writeFloatLE(tone, (i - audioEnd) * 8); pcm.writeFloatLE(tone, (i - audioEnd) * 8 + 4);
        }
        writer.audio(pcm, audioEnd / 48000); audioEnd = next;
      }
      for (let at = 2; at < 1280 * 30 * 4; at += 4) pixels[at] = Math.floor(frameTime * 50) % 255;
      return { width: 1280, height: 720, time: frameTime, pixels, input: [], audioLevel: .1,
        placement: { x: .8, y: .8 }, shrinkOnZoom: false,
        camera: { status: 'idle', cameraAvailable: true, cameraVisible: true, cameraEffects: ORIGINAL_CAMERA_EFFECTS,
          cameraShape: 'circle', cameraSize: .22, cameraMirror: false, microphoneEnabled: false, microphoneMuted: false,
          microphoneName: '', systemAudioEnabled: false, systemAudioMuted: false } };
    });
    ipcMain.handle('fixture:push', async (_event, value) => {
      assert.equal(value.byteLength, 1920 * 1080 * 4); outputFrames++; await writer.write(value, frameTime);
    });
    ipcMain.handle('fixture:window', (_event, action) => {
      if (action === 'show') window!.showInactive(); else if (action === 'hide') window!.hide();
      else if (action === 'minimize') window!.minimize(); else if (action === 'restore') window!.restore();
      else throw new Error('Unknown owned window action'); watcher!.publish();
    });
    await window.loadURL('data:text/html,<body style="margin:20px;background:%23242c39">Owned synthetic preview</body>');
    await window.webContents.executeJavaScript(await fs.readFile(path.join(directory, 'harness.js'), 'utf8'));
    started = performance.now();
    const rendering = await window.webContents.executeJavaScript(`runLiveDisplayChecks(${JSON.stringify({ id: 'owned-preview', width: 1920, height: 1080, fps: 30, style: DEFAULT_STYLE })})`);
    assert.deepEqual(failures, []); assert.equal(states.at(-1)?.status, 'streaming'); assert.ok(states.every(state => state.attempt === 0));
    await writer.stop(); await receiverDone;
    const video = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-progress', 'pipe:1', '-f', 'null', '-'], { maxBuffer: 1024 * 1024 });
    const audio = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-'], { encoding: 'buffer', maxBuffer: 24 * 1024 * 1024 });
    const decodedFrames = Number([...video.stdout.matchAll(/^frame=(\d+)/gm)].at(-1)?.[1]);
    let energy = 0; for (let at = 0; at < audio.stdout.length; at += 4) energy += audio.stdout.readFloatLE(at) ** 2;
    const rms = Math.sqrt(energy / (audio.stdout.length / 4)), audioSamples = audio.stdout.length / 8;
    const videoSeconds = decodedFrames / 30, audioSeconds = audioSamples / 48000;
    assert.ok(decodedFrames > 500); assert.ok(rms > .06); assert.ok(Math.abs(videoSeconds - audioSeconds) < .15);
    assert.ok(Math.abs(videoSeconds - rendering.seconds) < 1, 'Encoded output fell behind real capture time');
    await fs.writeFile(path.join(directory, 'receiver.log'), receiverLog);
    const report = { result: 'PASS', rendering, outputFrames, decodedFrames, audioSamples, rms, videoSeconds, audioSeconds,
      reconnects: 0, nativeWindowVisibility: windowStates, failures, isolatedProfile: true, physicalCapture: false, realPlatform: false };
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
  } catch (error) {
    await fs.writeFile(path.join(directory, 'failure.txt'), String(error instanceof Error ? error.stack : error));
    throw error;
  } finally { watcher?.dispose(); window?.destroy(); await writer.stop(); if (receiver.exitCode === null) receiver.kill(); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
