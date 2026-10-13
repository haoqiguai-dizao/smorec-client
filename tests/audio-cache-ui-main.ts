import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { audioCacheManager, disposeAudioCache } from '../electron/services/audio-cache';
import { installAudioCacheIpc } from '../electron/services/audio-cache-ipc';
import { resolveProcessedMicrophone, disposeMicrophoneEffects } from '../electron/services/microphone-effects';
import { writeSyntheticWave } from './fixtures/microphone-audio';
import { microphonePreset } from '../shared/microphone-effects';

const directory = path.resolve(process.env.AUDIO_CACHE_TEST_DIRECTORY!);
const profile = path.join(directory, 'profile'); mkdirSync(profile, { recursive: true });
app.setPath('userData', profile); app.setPath('sessionData', profile);
app.whenReady().then(async () => {
  const source = path.join(directory, 'original.wav');
  await writeSyntheticWave(source, 48000, 1, 96000, frame => .08 * Math.sin(frame * .03));
  const digest = createHash('sha256').update(await fs.readFile(source)).digest('hex');
  const manager = audioCacheManager(), lease = manager.lease();
  const removable = await resolveProcessedMicrophone(source, microphonePreset('natural'));
  const active = await resolveProcessedMicrophone(source, microphonePreset('clear'), undefined, lease);
  const lost = path.join(directory, 'lost-original.wav'); await fs.copyFile(source, lost);
  const missing = await resolveProcessedMicrophone(lost, microphonePreset('warm')); await fs.unlink(lost);
  const legacy = path.join(path.dirname(removable), `${'f'.repeat(64)}.wav`); await fs.copyFile(removable, legacy);
  const protectedFile = path.join(path.dirname(removable), 'unrelated.wav'); await fs.copyFile(source, protectedFile);
  const initial = await manager.state();
  const window = new BrowserWindow({ show: false, frame: false, width: 700, height: 540,
    webPreferences: { offscreen: true, preload: path.join(directory, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  let permissions = 0;
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => { permissions++; callback(false); });
  window.webContents.session.setPermissionCheckHandler(() => false);
  installAudioCacheIpc(event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame);
  ipcMain.handle('audio-cache-test:inspect', async () => ({ initial, state: await manager.state(), permissions,
    sourceUnchanged: createHash('sha256').update(await fs.readFile(source)).digest('hex') === digest,
    files: { removable: !!await fs.stat(removable).catch(() => undefined), active: !!await fs.stat(active).catch(() => undefined),
      protected: !!await fs.stat(protectedFile).catch(() => undefined), missing: !!await fs.stat(missing).catch(() => undefined), legacy: !!await fs.stat(legacy).catch(() => undefined) },
    isolated: app.getPath('userData') === profile && app.getPath('sessionData') === profile }));
  ipcMain.handle('audio-cache-test:release', () => lease.release());
  await window.loadFile(path.join(directory, 'harness.html'));
  app.on('before-quit', () => { lease.release(); disposeMicrophoneEffects(); disposeAudioCache(); });
}).catch(error => { console.error(error); app.exit(1); });
