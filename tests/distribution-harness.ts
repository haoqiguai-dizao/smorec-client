import { app, BrowserWindow, session } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { NsisUpdater } from 'electron-updater';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor';
import type { AppAdapter } from 'electron-updater/out/AppAdapter';
import { signedProvider } from '../electron/services/updates/signed-provider';
import { canonicalJson, parseRelease } from '../electron/services/updates/manifest';
import { UpdateManager } from '../electron/services/updates/manager';
import type { SignedRelease, UpdateConfiguration } from '../shared/update-types';

const directory = process.env.SMOREC_DISTRIBUTION_TEST;
if (!directory || !path.resolve(directory).startsWith(path.resolve('output/distribution-verification') + path.sep)) {
  throw new Error('Expected an isolated verification output directory');
}
app.setPath('userData', path.join(directory, 'profile'));
app.setPath('sessionData', path.join(directory, 'sessions'));
app.disableHardwareAcceleration();
const report: Record<string, unknown> = { result: 'FAIL', checks: [], installerExecutions: 0, windowsCreated: 0 };
const checks: string[] = [];
report.checks = checks;
let forbiddenCalls = 0;
const forbidden = () => { forbiddenCalls++; throw new Error('Installer or app lifecycle execution is forbidden'); };

async function main() {
  const out = directory!;
  const bytes = Buffer.from('SMOREC SYNTHETIC NON EXECUTABLE BYTES\n'.repeat(4096));
  const corrupt = Buffer.alloc(bytes.length, 0x23);
  const certificate = await fs.readFile(path.join(out, 'test-cert.pem'));
  const fingerprint = new X509Certificate(certificate).fingerprint256;
  setDefaultCACertificates([...getCACertificates(), certificate.toString()]);
  const requests: Record<string, number> = {};
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const server = createServer({ key: await fs.readFile(path.join(out, 'test-key.pem')), cert: certificate }, (request, response) => {
    const pathname = new URL(request.url!, 'https://127.0.0.1').pathname;
    requests[pathname] = (requests[pathname] ?? 0) + 1;
    if (pathname.startsWith('/offline/')) { request.socket.destroy(); return; }
    if (pathname.startsWith('/withdrawn/')) { response.writeHead(204).end(); return; }
    if (pathname.startsWith('/current/')) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(currentFeed)); return; }
    if (pathname === '/redirect.exe') { response.writeHead(302, { Location: '/good.exe' }).end(); return; }
    const body = pathname === '/bad.exe' ? corrupt : bytes;
    response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length });
    response.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const base = 'https://127.0.0.1:' + address.port;
  const config: UpdateConfiguration = { serviceUrl: base, channel: 'stable',
    publicKeys: { test: publicKey.export({ type: 'spki', format: 'pem' }).toString() } };
  function release(route = '/redirect.exe', version = '0.9.11'): SignedRelease {
    const payload: SignedRelease['payload'] = {
      product: 'smorec', version, channel: 'stable', publishedAt: new Date().toISOString(), releaseNotes: '合成更新验收',
      artifacts: [{ platform: 'win32', arch: 'x64', name: 'synthetic.exe', url: base + route, size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sha512: createHash('sha512').update(bytes).digest('base64') }],
    };
    return parseRelease({ schema: 1, keyId: 'test', payload,
      signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') }, config);
  }
  const currentFeed = release('/good.exe', '0.9.10');
  const network = session.fromPartition('electron-updater', { cache: false });
  await network.setProxy({ mode: 'direct' });
  network.setCertificateVerifyProc((request, callback) => {
    const trusted = request.hostname === '127.0.0.1' && new X509Certificate(request.certificate.data).fingerprint256 === fingerprint;
    callback(trusted ? 0 : -2);
  });
  network.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: new URL(details.url).origin !== base });
  });
  async function updaterFor(name: string, target = release(), withConfig = true, version = '0.9.10') {
    const fixture = path.join(out, name);
    await fs.mkdir(path.join(fixture, 'profile'), { recursive: true });
    const configPath = path.join(fixture, 'app-update.yml');
    if (withConfig) await fs.writeFile(configPath, 'updaterCacheDirName: synthetic-updater\n', 'utf8');
    const adapter: AppAdapter = {
      version, name: 'synthetic', isPackaged: true, appUpdateConfigPath: configPath,
      userDataPath: path.join(fixture, 'profile'), baseCachePath: path.join(fixture, 'cache'),
      whenReady: async () => {}, relaunch: forbidden, quit: forbidden, onQuit: forbidden,
    };
    const updater = new NsisUpdater(undefined, adapter);
    Object.assign(updater, { httpExecutor: new ElectronHttpExecutor() });
    updater.setFeedURL({ provider: 'custom', updateProvider: signedProvider(target) });
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    updater.disableDifferentialDownload = true; updater.disableWebInstaller = true; updater.allowDowngrade = false;
    updater.logger = null; updater.quitAndInstall = forbidden;
    let downloaded = '';
    const errors: string[] = [];
    updater.on('update-downloaded', event => { downloaded = event.downloadedFile; });
    updater.on('error', error => errors.push(error.message));
    return { updater, downloaded: () => downloaded, errors };
  }
  try {
    const missing = await updaterFor('missing-config', release(), false);
    await missing.updater.checkForUpdates();
    await assert.rejects(missing.updater.downloadUpdate(), /ENOENT/);
    assert.equal(missing.downloaded(), '');
    checks.push('missing-app-update-yml-rejected');

    const first = await updaterFor('cache');
    const result = await first.updater.checkForUpdates();
    assert.equal(result?.isUpdateAvailable, true);
    const files = await first.updater.downloadUpdate(result!.cancellationToken);
    assert.equal(files.length, 1); assert.equal(first.downloaded(), files[0]);
    assert.deepEqual(await fs.readFile(files[0]), bytes);
    assert(requests['/good.exe'] > 0 && requests['/redirect.exe'] > 0);
    const count = requests['/good.exe'];
    const cached = await updaterFor('cache');
    await cached.updater.checkForUpdates();
    assert.deepEqual(await cached.updater.downloadUpdate(), files);
    assert.equal(cached.downloaded(), files[0]); assert.equal(requests['/good.exe'], count);
    checks.push('real-nsis-download-and-update-downloaded', 'https-302-download', 'cache-reuse-without-network');

    await fs.writeFile(files[0], corrupt);
    const repair = await updaterFor('cache');
    await repair.updater.checkForUpdates();
    await repair.updater.downloadUpdate();
    assert(requests['/good.exe'] > count);
    assert.deepEqual(await fs.readFile(files[0]), bytes);
    checks.push('tampered-cache-redownloaded');

    const bad = await updaterFor('bad-sha512', release('/bad.exe'));
    await bad.updater.checkForUpdates();
    await assert.rejects(bad.updater.downloadUpdate(), /sha512|checksum/i);
    assert.equal(bad.downloaded(), '');
    assert(bad.errors.length > 0);
    checks.push('bad-sha512-rejected-before-ready');

    const current = await updaterFor('already-current', release('/good.exe', '0.9.10'));
    assert.equal((await current.updater.checkForUpdates())?.isUpdateAvailable, false);
    const downgrade = await updaterFor('downgrade', release('/good.exe', '0.9.9'));
    assert.equal((await downgrade.updater.checkForUpdates())?.isUpdateAvailable, false);
    checks.push('current-version-no-download', 'older-version-no-downgrade');

    async function managerCase(name: string, endpoint: string, startup: boolean) {
      const managerDir = path.join(out, name);
      await fs.mkdir(managerDir, { recursive: true });
      const pendingPath = path.join(managerDir, 'pending.json');
      await fs.writeFile(pendingPath, JSON.stringify({ release: release() }));
      const manager = new UpdateManager({ directory: managerDir, version: '0.9.10',
        config: { ...config, serviceUrl: base + endpoint }, packaged: true,
        changed: () => {}, apply: async () => { forbidden(); return { status: 'deferred', reason: 'busy' }; }, installed: () => {}, failed: () => {} });
      if (startup) assert.equal(await manager.installPendingOnStartup(), false);
      else await manager.check();
      const state = manager.snapshot().status;
      manager.stop();
      return { state, pendingExists: await fs.stat(pendingPath).then(() => true, () => false) };
    }
    assert.deepEqual(await managerCase('withdrawn', '/withdrawn', true), { state: 'idle', pendingExists: false });
    assert.deepEqual(await managerCase('offline', '/offline', true), { state: 'error', pendingExists: true });
    assert.deepEqual(await managerCase('manager-current', '/current', false), { state: 'idle', pendingExists: false });
    checks.push('withdrawn-pending-not-installed', 'offline-pending-retained-no-install', 'manager-current-no-download');

    assert.equal(BrowserWindow.getAllWindows().length, 0); assert.equal(forbiddenCalls, 0);
    Object.assign(report, { result: 'PASS', checks, bytesDownloaded: bytes.length, installerExecutions: forbiddenCalls,
      windowsCreated: BrowserWindow.getAllWindows().length, network: 'isolated-loopback-https',
      transport: 'real-ElectronHttpExecutor', updater: 'real-NsisUpdater', appAdapter: 'isolated-test-directories',
      cacheFile: files[0], requests });
  } finally {
    network.webRequest.onBeforeRequest(null); network.setCertificateVerifyProc(null);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void app.whenReady().then(main).then(async () => {
  await fs.writeFile(path.join(directory!, 'report.json'), JSON.stringify(report, null, 2));
  app.exit(0);
}, async error => {
  await fs.writeFile(path.join(directory!, 'report.json'), JSON.stringify({ ...report, error: String(error) }, null, 2));
  console.error(error); app.exit(1);
});
