import { app, net, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import assert from 'node:assert/strict';
import { UpdateManager } from '../electron/services/updates/manager';
import { handoffStagedPackage } from '../electron/services/updates/staged-handoff';
import { recoverStagedPackages } from '../electron/services/updates/staged-package';

const root = process.env.SMOREC_STAGED_LIFECYCLE;
if (!root || !path.resolve(root).includes(path.join('output', 'staged-updates') + path.sep)) throw new Error('Isolated fixture required');
const out = root;
app.setPath('userData', path.join(out, 'profile')); app.disableHardwareAcceleration();
const event = async (value: unknown) => fs.appendFile(path.join(out, 'events.jsonl'), JSON.stringify(value) + '\n');
async function run() {
  const config = JSON.parse(await fs.readFile(path.join(out, 'config.json'), 'utf8'));
  const fingerprint = new X509Certificate(await fs.readFile(path.join(out, 'test-cert.pem'))).fingerprint256;
  await session.defaultSession.setProxy({ mode: 'direct' });
  session.defaultSession.setCertificateVerifyProc((request, callback) => callback(request.hostname === '127.0.0.1'
    && new X509Certificate(request.certificate.data).fingerprint256 === fingerprint ? 0 : -2));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: new URL(details.url).origin !== config.serviceUrl }));
  await event({ stage: 'boot', version: app.getVersion(), packaged: app.isPackaged, pid: process.pid });
  assert.equal(app.isPackaged, true);
  let installed: string | undefined;
  const manager = new UpdateManager({ directory: path.join(out, 'updates'), version: app.getVersion(), config,
    packaged: app.isPackaged, automaticRelaunch: app.commandLine.hasSwitch('updated'),
    packageHelper: path.join(process.resourcesPath, 'updater/XiaoLu.Updater.exe'), installDirectory: path.dirname(process.execPath),
    recover: () => recoverStagedPackages(path.join(out, 'updates'), path.dirname(process.execPath), app.getVersion(), path.join(process.resourcesPath, 'updater/XiaoLu.Updater.exe')),
    changed: value => { void event({ stage: 'state', ...value }); }, installed: version => { installed = version; }, failed() {},
    fetch: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
    apply: async prepared => {
      assert.ok(prepared.staged); assert.equal(prepared.updater, undefined);
      return handoffStagedPackage(prepared.staged, { currentExecutable: process.execPath, busy: () => false,
        beforeQuit: async () => { await event({ stage: 'native-handoff' }); }, cancelQuit() {}, quit: () => app.quit() });
    } });
  if (app.getVersion() === '0.9.17') {
    if (process.env.SMOREC_STAGED_VERIFY_CLEANUP === '1') {
      assert.equal(await manager.installPendingOnStartup(), false);
      assert.notEqual(manager.snapshot().manualDownload, true);
      assert.deepEqual((await fs.readdir(path.join(out, 'updates'))).filter(name => name.startsWith('session-')), []);
      await fs.writeFile(path.join(out, 'cleanup-report.json'), JSON.stringify({ result: 'PASS',
        coldStartupAfterCompletedUpdate: true, asarCacheRemoved: true, updateStillEnabled: true }));
      await manager.stop(); app.quit(); return;
    }
    assert.equal(await manager.installPendingOnStartup(), false); assert.equal(installed, '0.9.17');
    await assert.rejects(fs.access(path.join(out, 'updates/pending.json')));
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ result: 'PASS', version: app.getVersion(),
      signedDownload: true, backgroundPreparation: true, normalRestart: true, nativeHandoff: true, newVersionRelaunched: true, pendingCleared: true }));
    await manager.stop(); app.quit(); return;
  }
  const pending = await fs.access(path.join(out, 'updates/pending.json')).then(() => true, () => false);
  if (pending) { assert.equal(await manager.installPendingOnStartup(), true); return; }
  await manager.check(); assert.equal(manager.snapshot().status, 'ready');
  const pointer = JSON.parse(await fs.readFile(path.join(out, 'updates/staged.json'), 'utf8'));
  const nextPackage = JSON.parse(await fs.readFile(path.join(out, 'updates', pointer.session, 'staged/resources/app.asar/package.json'), 'utf8'));
  assert.equal(nextPackage.version, '0.9.17');
  await manager.prepareRestart(); await event({ stage: 'normal-restart' });
  await manager.stop(); app.relaunch({ args: [] }); app.quit();
}
void app.whenReady().then(run).catch(async error => {
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({ result: 'FAIL', error: String(error), stack: error.stack })); app.exit(1);
});
