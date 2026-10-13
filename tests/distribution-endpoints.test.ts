import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import type { createDistribution } from '../electron/services/distribution';

interface CapturedUpdater { config: { serviceUrl: string }; fetch: typeof fetch }
async function fixture(serviceUrl: string, directory: string) {
  const requests: { url: string; init?: RequestInit }[] = [];
  const injected = {
    handlers: new Map<string, (...args: unknown[]) => Promise<void>>(), busy: false, becomeBusy: false, restarts: 0,
    serviceUrl, directory, updater: undefined as CapturedUpdater | undefined,
    fetch: async (url: string, init?: RequestInit) => { requests.push({ url, init }); return { status: 202 }; },
  };
  const mocks: Record<string, string> = {
    electron: `export const app = { commandLine: { hasSwitch: () => false }, isPackaged: true, getPath: () => injected.directory, getVersion: () => '9.8.7' };
      export const net = { fetch: injected.fetch }; export const ipcMain = { handle: (name, handler) => injected.handlers.set(name, handler) };
      export const Notification = { isSupported: () => false }; export const shell = { openExternal: () => { throw new Error('No browser navigation allowed'); } };`,
    '../../config/distribution.json': `export default { serviceUrl: injected.serviceUrl, channel: 'stable', publicKeys: {} };`,
    './updates/manager': `export class UpdateManager {
      constructor(options) { injected.updater = options; }
      start() {} async stop() {} async prepareRestart() { if(injected.becomeBusy) injected.busy=true; }
      snapshot() { return { status: 'idle', currentVersion: '9.8.7' }; }
    }`,
    './updates/windows-installer': `export const prepareWindowsInstall = () => { throw new Error('No installer allowed'); };
      export const handoffWindowsInstall = prepareWindowsInstall;`,
  };
  const bundle = await build({ entryPoints: [path.resolve('electron/services/distribution.ts')], bundle: true,
    define: { 'process.platform': JSON.stringify('win32') },
    write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'distribution-endpoint-fixture', setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'js' }));
      },
    }] });
  const module = { exports: {} as { createDistribution: typeof createDistribution } };
  new Function('require', 'module', 'exports', 'injected', '__dirname', bundle.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, injected, path.resolve('dist-electron'),
  );
  return { injected, requests, create: () => module.exports.createDistribution({ window: () => undefined,
    trusted: () => true, busy: () => injected.busy, restart: async () => { injected.restarts++; }, beforeUpdateQuit: async () => {}, cancelUpdateQuit: () => {} }) };
}

test('distribution sends opt-in events to the batch route while preserving the updater base URL', async t => {
  for (const [serviceUrl, expectedEndpoint] of [
    ['https://legacy.example.test/smorec', 'https://legacy.example.test/smorec/api/events/batch'],
    ['https://legacy.example.test/smorec/', 'https://legacy.example.test/smorec/api/events/batch'],
    ['https://product.example.test', 'https://product.example.test/api/events/batch'],
    ['https://product.example.test/', 'https://product.example.test/api/events/batch'],
    ['https://product.example.test///', 'https://product.example.test/api/events/batch'],
  ]) await t.test(serviceUrl, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smorec-endpoint-'));
    let distribution: ReturnType<typeof createDistribution> | undefined;
    try {
      const { create, requests, injected } = await fixture(serviceUrl, directory);
      distribution = create();
      assert.equal(injected.updater?.config.serviceUrl, serviceUrl);
      assert.equal(requests.length, 0, 'construction must not send telemetry');
      await distribution.telemetry.setEnabled(true);
      await distribution.start();
      await distribution.stop();
      assert(requests.length > 0, 'exercise the real telemetry transport, not only configuration');
      for (const request of requests) {
        assert.equal(request.url, expectedEndpoint);
        assert.equal(request.init?.method, 'POST');
        assert.equal(request.init?.redirect, 'error');
        const body = JSON.parse(request.init?.body as string) as { schema_version: number; events: { name: string }[] };
        assert.equal(body.schema_version, 1);
        assert(body.events.length > 0);
      }
      assert.equal(distribution.telemetry.snapshot().queuedEvents, 0, 'accepted batches clear their local queue');
      assert(injected.updater);
      await injected.updater.fetch(new URL(serviceUrl.replace(/\/+$/, '') + '/api/updates/latest'));
      assert.equal(requests.at(-1)?.url, serviceUrl.replace(/\/+$/, '') + '/api/updates/latest');
    } finally { await distribution?.stop(); await fs.rm(directory, { recursive: true, force: true }); }
  });
  await t.test('empty service URL is rejected before any network request', async () => {
    const { create, requests } = await fixture('', os.tmpdir());
    assert.throws(create, /Telemetry configuration is invalid/);
    assert.equal(requests.length, 0);
  });
});


test('restart update refuses active work, including work started during preparation', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'smorec-restart-guard-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const f = await fixture('https://updates.example.test', directory);
  f.create().installIpc();
  const restart = f.injected.handlers.get('distribution:restart')!;
  f.injected.busy = true;
  await assert.rejects(restart({}), /录制/);
  f.injected.busy = false; f.injected.becomeBusy = true;
  await assert.rejects(restart({}), /录制/);
  assert.equal(f.injected.restarts, 0);
  f.injected.busy = false; f.injected.becomeBusy = false;
  await restart({}); assert.equal(f.injected.restarts, 1);
});
