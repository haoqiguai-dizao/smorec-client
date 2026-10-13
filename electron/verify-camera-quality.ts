/** Isolated Canvas-only test. All physical media permissions are denied. */
import { app, BrowserWindow } from 'electron';
import { promises as fs, mkdirSync } from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.env.FRAMEFLOW_QUALITY_OUTPUT!);
if (!process.env.FRAMEFLOW_QUALITY_OUTPUT) throw new Error('Explicit isolated test directory required');
mkdirSync(path.join(directory, 'profile'), { recursive: true });
app.setPath('userData', path.join(directory, 'profile'));
app.setPath('sessionData', path.join(directory, 'profile'));
let window: BrowserWindow | undefined;
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on('console-message', details => {
    void fs.appendFile(path.join(directory, 'renderer.log'), details.message + '\n');
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await window.loadFile(path.join(directory, 'harness.html'));
  const report = await window.webContents.executeJavaScript('window.runCameraQualityChecks()');
  for (const [name, item] of [['effects-1080', report.effects], ['effects-strength-contact-sheet', report.strength],
    ...report.peers.map((peer: { source: { width: number } }) => ['received-' + peer.source.width, peer])] as [string, { image?: string }][]) {
    if (item.image) { await fs.writeFile(path.join(directory, name + '.png'), Buffer.from(item.image.split(',')[1], 'base64')); delete item.image; }
  }
  await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ result: 'PASS', physicalDevicesUsed: false, report }, null, 2));
  window.destroy(); app.exit(0);
}).catch(async error => {
  await fs.writeFile(path.join(directory, 'failure.txt'), error.stack ?? String(error));
  console.error(error); window?.destroy(); app.exit(1);
});
