import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { build } from 'esbuild';

async function fixture(platform: string, singleInstance = true) {
  let quits = 0, shutdowns = 0, prevented = 0, allowClose = false;
  const app = Object.assign(new EventEmitter(), {
    requestSingleInstanceLock: () => singleInstance,
    quit: () => { quits++; }, whenReady: () => Promise.resolve(),
  });
  const bundle = await build({ entryPoints: ['electron/services/application-lifecycle.ts'], bundle: true,
    platform: 'node', format: 'cjs', write: false, logLevel: 'silent', plugins: [{ name: 'lifecycle-fixture', setup(b) {
      b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'module.exports={app};' }));
    } }] });
  const module = { exports: {} as { installApplicationLifecycle(options: unknown): void } };
  new Function('module', 'exports', 'app', 'process', bundle.outputFiles[0].text)(module, module.exports, app, { platform });
  module.exports.installApplicationLifecycle({ ready: () => true, wake: () => {}, allowClose: () => allowClose,
    shutdown: async () => { shutdowns++; }, initialize: async () => {}, failed: () => {}, dispose: () => {} });
  return { app, snapshot: () => ({ quits, shutdowns, prevented }), allow: () => { allowClose = true; },
    quitEvent: () => app.emit('before-quit', { preventDefault: () => { prevented++; } }) };
}

test('Mac closing the final permission window keeps the process alive for the workspace handoff', async () => {
  const f = await fixture('darwin'); f.app.emit('window-all-closed');
  assert.deepEqual(f.snapshot(), { quits: 0, shutdowns: 0, prevented: 0 });
  f.quitEvent(); assert.deepEqual(f.snapshot(), { quits: 0, shutdowns: 1, prevented: 1 });
  f.allow(); f.quitEvent(); assert.deepEqual(f.snapshot(), { quits: 0, shutdowns: 1, prevented: 1 });
});

test('Windows and Linux still request normal shutdown when all windows close', async () => {
  for (const platform of ['win32', 'linux']) {
    const f = await fixture(platform); f.app.emit('window-all-closed'); assert.equal(f.snapshot().quits, 1);
  }
});

test('a second process exits without attaching window lifecycle handlers', async () => {
  const f = await fixture('darwin', false); assert.equal(f.snapshot().quits, 1);
  assert.equal(f.app.listenerCount('window-all-closed'), 0);
});
