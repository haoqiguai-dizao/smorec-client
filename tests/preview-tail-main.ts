import { app, BrowserWindow, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ProjectStore } from '../electron/services/projects';
import { installProtocol } from '../electron/services/protocol';

const directory = process.env.PREVIEW_TAIL_OUTPUT!, projectDirectory = process.env.PREVIEW_TAIL_PROJECT!;
if (!directory || !projectDirectory) throw new Error('Explicit isolated project/output required');
app.setPath('userData', path.join(directory, 'profile'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.whenReady().then(async () => {
  const projects = new ProjectStore({ root: () => path.dirname(projectDirectory) });
  const project = await projects.load(path.basename(projectDirectory));
  installProtocol(projects, 'file:///');
  ipcMain.handle('microphone-integration', (_event, method) => { if (method === 'project') return project; throw new Error('Read-only preview probe'); });
  const window = new BrowserWindow({ show: false, width: 1000, height: 660, webPreferences: {
    offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(directory, 'preload.cjs') } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  await window.loadFile(path.join(directory, 'harness.html'));
}).catch(async error => { await fs.writeFile(path.join(directory, 'startup-failure.txt'), String(error)); app.exit(1); });
