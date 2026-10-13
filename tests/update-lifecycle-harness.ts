import { app, net, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
import { UpdateManager } from '../electron/services/updates/manager';
import { prepareWindowsInstall, handoffWindowsInstall } from '../electron/services/updates/windows-installer';

const root = process.env.SMOREC_UPDATE_LIFECYCLE;
if (!root || !path.resolve(root).includes(path.join('output', 'update-lifecycle') + path.sep)) throw new Error('Isolated fixture required');
const out = root;
app.setPath('userData', path.join(out, 'profile'));
app.disableHardwareAcceleration();
const event = async (value: unknown) => fs.appendFile(path.join(out, 'events.jsonl'), JSON.stringify(value) + '\n');
async function run() {
  const config = JSON.parse(await fs.readFile(path.join(out, 'config.json'), 'utf8'));
  const fingerprint = new X509Certificate(await fs.readFile(path.join(out, 'test-cert.pem'))).fingerprint256;
  for (const network of [session.defaultSession, session.fromPartition('electron-updater', { cache: false })]) {
    await network.setProxy({ mode: 'direct' });
    network.setCertificateVerifyProc((request, callback) => callback(request.hostname === '127.0.0.1'
      && new X509Certificate(request.certificate.data).fingerprint256 === fingerprint ? 0 : -2));
    network.webRequest.onBeforeRequest((details, callback) => callback({ cancel: new URL(details.url).origin !== config.serviceUrl }));
  }
  await event({ stage: 'boot', version: app.getVersion(), packaged: app.isPackaged, pid: process.pid });
  assert.equal(app.isPackaged, true);
  let installed: string | undefined;
  const manager = new UpdateManager({ directory: path.join(out, 'updates'), version: app.getVersion(), config,
    packaged: app.isPackaged, automaticRelaunch: app.commandLine.hasSwitch('updated'),
    changed: value => { void event({ stage: 'state', ...value }); }, installed: version => { installed = version; }, failed() {},
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
    apply: async prepared => {
      const artifact = prepared.release.payload.artifacts[0];
      const result = await prepareWindowsInstall({ installer: { path: prepared.file, sha256: artifact.sha256, size: artifact.size },
        currentExecutable: process.execPath, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged, isBusy: () => false, allowElevation: true });
      await event({ stage: 'preflight', status: result.status });
      if (result.status !== 'ready') return result;
      assert.ok(prepared.updater);
      return handoffWindowsInstall(result.plan, prepared.updater, { getDownloadedFile: prepared.getDownloadedFile,
        isBusy: () => false, beforeQuit: async () => { await event({ stage: 'handoff' }); } });
    } });
  if (app.getVersion() === '0.9.13') {
    assert.equal(await manager.installPendingOnStartup(), false);assert.equal(installed, '0.9.13');
    await assert.rejects(fs.access(path.join(out, 'updates', 'pending.json')));
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ result: 'PASS', version: app.getVersion(),
      signedDownload: true, normalRestart: true, realNsisHandoff: true, newVersionRelaunched: true, pendingCleared: true }));
    await manager.stop();app.quit();return;
  }
  const pending = await fs.access(path.join(out, 'updates', 'pending.json')).then(() => true, () => false);
  if (pending) { assert.equal(await manager.installPendingOnStartup(), true);return; }
  await manager.check();assert.equal(manager.snapshot().status, 'ready');
  await manager.prepareRestart();await event({ stage: 'normal-restart' });
  await manager.stop();app.relaunch({ args: [] });app.quit();
}
void app.whenReady().then(run).catch(async error => {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ result: 'FAIL', error: String(error), stack: error.stack }));app.exit(1);
});
