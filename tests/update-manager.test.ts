import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { build } from 'esbuild';
import { canonicalJson } from '../electron/services/updates/manifest';
import { updateFailureMessage } from '../electron/services/updates/outcome';
import type { UpdateManager } from '../electron/services/updates/manager';
import type { WindowsInstallResult } from '../electron/services/updates/windows-installer';
import type { SignedRelease } from '../shared/update-types';

async function fixture(t: { after(fn: () => Promise<void>): void }, platform: 'win32' | 'darwin' = 'win32') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smorec-update-manager-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const payload: SignedRelease['payload'] = { product: 'smorec', version: '0.9.13', channel: 'stable',
    publishedAt: new Date().toISOString(), releaseNotes: 'Test update', artifacts: [{ platform: 'win32', arch: 'x64',
      name: 'test.exe', url: 'https://updates.example.test/test.exe', size: 100, sha256: 'ab'.repeat(32),
      sha512: Buffer.alloc(64, 1).toString('base64') }] };
  const macBytes = Buffer.from('isolated-mac-update-fixture');
  if (platform === 'darwin') payload.macArtifacts = ['dmg', 'zip'].map(extension => ({ platform: 'darwin', arch: 'arm64',
    name: 'test-arm64.' + extension, url: 'https://updates.example.test/test-arm64.' + extension, size: macBytes.length,
    sha256: createHash('sha256').update(macBytes).digest('hex'), sha512: createHash('sha512').update(macBytes).digest('base64') }));
  const release: SignedRelease = { schema: 1, keyId: 'test', payload,
    signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') };
  const injected = { release, downloads: 0, failDownload: false, file: path.join(directory, platform === 'darwin' ? 'test.zip' : 'test.exe'), mac: platform === 'darwin' };
  if (platform === 'darwin') await fs.writeFile(injected.file, macBytes);
  const bundled = await build({ entryPoints: ['electron/services/updates/manager.ts'], bundle: true, write: false,
    // This fixture exercises Windows installer behavior on either developer host.
    define: { 'process.platform': JSON.stringify(platform), 'process.arch': JSON.stringify(platform === 'darwin' ? 'arm64' : 'x64') },
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'nsis-no-execution', setup(b) {
      b.onResolve({ filter: /\.\/mac\/package$/ }, () => ({ path: 'mac-package', namespace: 'mac-fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'mac-fixture' }, () => ({ loader: 'js', contents: `
        export async function prepareMacPackage(options) {
          injected.downloads++; if(injected.failDownload) throw new Error('interrupted');
          if (!options.release.signature) throw new Error('unsigned');
          options.preparing(); return {plan:{session:'fixture'},planFile:'fixture',helper:'fixture'};
        }
      ` }));
      b.onResolve({ filter: /^electron-updater$/ }, () => ({ path: 'nsis', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'js', contents: `
        import { EventEmitter } from 'node:events';
        export class NsisUpdater extends EventEmitter {
          async checkForUpdates() { return { updateInfo: {version: injected.release.payload.version}, cancellationToken: {cancel(){}} }; }
          async downloadUpdate() { injected.downloads++; if(injected.failDownload)throw new Error('interrupted');
            this.emit('update-downloaded',{downloadedFile:injected.file});return injected.mac ? [] : [injected.file]; }
        }
        export class MacUpdater extends NsisUpdater {}
        ` }));
    } }] });
  const module = { exports: {} as { UpdateManager: typeof UpdateManager } };
  new Function('require', 'module', 'exports', 'injected', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, injected);
  const managers: UpdateManager[] = [];
  const errors: unknown[] = [];
  let applies = 0, networkFails = false, withdrawn = false, invalidSignature = false, outcome: WindowsInstallResult = { status: 'handoff-requested' };
  const create = (automaticRelaunch = false) => {
    const manager = new module.exports.UpdateManager({ directory, version: '0.9.12', packaged: true, automaticRelaunch,
      macHelper: 'fixture', installDirectory: '/fixture/小录.app',
      config: { serviceUrl: 'https://updates.example.test', channel: 'stable', publicKeys: { test: publicKey.export({format:'pem',type:'spki'}).toString() } },
      changed() {}, installed() {}, failed() {}, reportError: error => errors.push(error), apply: async () => { applies++; return outcome; },
      fetch: async () => { if(networkFails)throw new Error('offline');if(withdrawn)return new Response(null,{status:204});return new Response(JSON.stringify(invalidSignature?{...release,signature:'invalid'}:release)); } });
    managers.push(manager);return manager;
  };
  t.after(async () => { for(const manager of managers)await manager.stop(); await fs.rm(directory,{recursive:true,force:true}); });
  return { create, injected, errors, set withdrawn(value: boolean){withdrawn=value;}, set invalidSignature(value: boolean){invalidSignature=value;}, set networkFails(value: boolean) {networkFails=value;},
    set outcome(value: WindowsInstallResult) {outcome=value;}, get applies(){return applies;},
    async pending(attemptedAt?: number) { await fs.writeFile(path.join(directory,'pending.json'),JSON.stringify({release,attemptedAt})); },
    async readPending() {return JSON.parse(await fs.readFile(path.join(directory,'pending.json'),'utf8'));} };
}

test('a normal restart retries immediately after a previous attempted install', async t => {
  const f=await fixture(t);await f.pending(Date.now());
  assert.equal(await f.create().installPendingOnStartup(),true);assert.equal(f.applies,1);
});
test('preflight deferral keeps the package without cooldown and exposes the reason', async t => {
  const f=await fixture(t);await f.pending();f.outcome={status:'deferred',reason:'busy'};
  const manager=f.create();assert.equal(await manager.installPendingOnStartup(),false);
  assert.equal(manager.snapshot().status,'deferred');assert.match(manager.snapshot().error!,/录制/);
  assert.equal((await f.readPending()).attemptedAt,undefined);
  await manager.check();assert.equal(manager.snapshot().status,'deferred');assert.match(manager.snapshot().error!,/录制/);
  f.outcome={status:'handoff-requested'};assert.equal(await f.create().installPendingOnStartup(),true);
});
test('unchanged installer relaunch prevents loops but permits an explicit restart', async t => {
  const f=await fixture(t);await f.pending(Date.now());const manager=f.create(true);
  assert.equal(await manager.installPendingOnStartup(),false);assert.equal(f.applies,0);
  assert.equal(manager.snapshot().status,'deferred');await manager.check();assert.equal(manager.snapshot().status,'deferred');
  await manager.prepareRestart();assert.equal((await f.readPending()).attemptedAt,undefined);
  assert.equal(await f.create().installPendingOnStartup(),true);
});
test('offline startup applies a previously signed cached pending release', async t => {
  const f=await fixture(t);await f.pending();f.networkFails=true;const manager=f.create();
  assert.equal(await manager.installPendingOnStartup(),true);assert.equal(f.applies,1);
});
test('offline startup with a missing cache stays recoverable without executing an installer', async t => {
  const f=await fixture(t);await f.pending();f.networkFails=true;f.injected.failDownload=true;
  const manager=f.create();assert.equal(await manager.installPendingOnStartup(),false);
  assert.equal(manager.snapshot().status,'error');assert.equal(f.applies,0);
  f.networkFails=false;f.injected.failDownload=false;assert.equal(await f.create().installPendingOnStartup(),true);
});
test('interrupted downloads never offer restart and recover after a later check', async t => {
  const f=await fixture(t);const manager=f.create();f.injected.failDownload=true;await manager.check();
  assert.equal((f.errors[0] as Error).message, 'interrupted');
  assert.equal(manager.snapshot().status,'error');await assert.rejects(manager.prepareRestart());assert.equal(f.applies,0);
  f.injected.failDownload=false;await manager.check();assert.equal(manager.snapshot().status,'ready');await manager.prepareRestart();
  assert.equal(await f.create().installPendingOnStartup(),true);
});
test('updater failures keep a visible retry action without exposing command output', () => {
  assert.equal(updateFailureMessage(new Error('Mac 更新包摘要校验失败')), 'Mac 更新包摘要校验失败，点击重试');
  assert.equal(updateFailureMessage(new Error('Command failed: /private/tmp/mac-update-helper stage')), '更新包下载或准备失败，请点击重试');
});
test('installer failure is not reported as a completed or ready update', async t => {
  const f=await fixture(t);await f.pending();f.outcome={status:'failed',error:'test failure'};
  const manager=f.create();assert.equal(await manager.installPendingOnStartup(),false);assert.equal(manager.snapshot().status,'deferred');
  await manager.check();assert.equal(manager.snapshot().status,'deferred');assert.ok((await f.readPending()).attemptedAt);
});

test('withdrawn or invalid newer metadata never falls back to a cached release', async t => {
  const f=await fixture(t);await f.pending();f.invalidSignature=true;
  assert.equal(await f.create().installPendingOnStartup(),false);assert.equal(f.applies,0);
  f.invalidSignature=false;f.withdrawn=true;
  assert.equal(await f.create().installPendingOnStartup(),false);assert.equal(f.applies,0);await assert.rejects(f.readPending());
});

test('Mac signed release uses staged package handoff without Squirrel or Apple team identity', async t => {
  const context = await fixture(t, 'darwin');
  const manager = context.create();
  await manager.check();
  assert.equal(manager.snapshot().status, 'ready');
  assert.equal(await manager.installPendingOnStartup(), true);
});
