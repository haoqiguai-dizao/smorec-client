import { app, BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { installProtocol } from '../electron/services/protocol';
import { disposeMediaProcesses } from '../electron/services/ffmpeg';
import { disposeAudioCache } from '../electron/services/audio-cache';

const directory = path.resolve(process.env.AUDIO_STORAGE_BROWSER_DIRECTORY!);
const file = path.resolve(process.env.AUDIO_STORAGE_BROWSER_FILE!);
const allowed = path.resolve('output/audio-storage-implementation') + path.sep;
if (!file.startsWith(allowed) || !directory.startsWith(allowed)) throw new Error('Only this test\'s synthetic output is allowed');
const profile = path.join(directory, 'profile'); mkdirSync(profile, { recursive: true });
app.setPath('userData', profile); app.setPath('sessionData', profile);
const token = randomUUID(), controller = new AbortController();
app.whenReady().then(async () => {
  installProtocol({} as never, undefined, value => {
    if (value !== token) throw new Error('Unknown synthetic asset'); return file;
  }, undefined, () => controller.signal);
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<audio muted src="frameflow://audio/${token}"></audio>`));
}).catch(error => { console.error(error); app.exit(1); });
app.on('before-quit', () => { controller.abort(); disposeMediaProcesses(); disposeAudioCache(); });
