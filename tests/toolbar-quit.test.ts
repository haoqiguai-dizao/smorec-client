import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { ToolbarActivity } from '../electron/services/toolbar-integration';

async function fixture() {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  const frame = { url: 'frameflow://app/index.html?overlay=launcher' };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const window = { webContents: sender, isDestroyed: () => false };
  let activity: ToolbarActivity = { recording: false, live: false, exporting: false, quitting: false }, response = 0, quits = 0, dialogs = 0, race = false;
  const injected = { BrowserWindow: { fromWebContents: (s: unknown) => s === sender ? window : undefined },
    ipcMain: { handle: (n: string, h: (...args: unknown[]) => Promise<unknown>) => handlers.set(n, h) },
    dialog: { showMessageBox: async () => { dialogs++; if (race) activity.exporting = true; return { response }; } } };
  const bundled = await build({ entryPoints: ['electron/services/toolbar-integration.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [{ name: 'electron-fixture', setup(b) {
    b.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'module.exports = injected;' }));
  } }] });
  const module = { exports: {} as { installToolbarIntegration(options: unknown): void } };
  new Function('require', 'module', 'exports', 'injected', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, injected);
  module.exports.installToolbarIntegration({ launcher: () => window, toolbar: () => undefined, activity: () => activity, quit: async () => { quits++; } });
  const event = { sender, senderFrame: frame };
  return { run: (...args: unknown[]) => handlers.get('toolbar:quit')!(event, ...args),
    foreign: () => handlers.get('toolbar:quit')!({ sender, senderFrame: { ...frame } }),
    state: (value: Partial<ToolbarActivity>) => { activity = { ...activity, ...value }; }, confirm: () => { response = 1; }, race: () => { race = true; }, result: () => ({ quits, dialogs }) };
}
test('idle toolbar exits through the saved shutdown path; forged frames and arguments cannot quit', async () => {
  const f = await fixture(); await assert.rejects(f.foreign(), /来源/); await assert.rejects(f.run('extra'), /参数/);
  assert.equal(await f.run(), true); assert.deepEqual(f.result(), { quits: 1, dialogs: 0 });
});
test('active capture requires explicit confirmation and cancellation leaves the application running', async () => {
  const f = await fixture(); f.state({ recording: true }); assert.equal(await f.run(), false);
  assert.deepEqual(f.result(), { quits: 0, dialogs: 1 }); f.confirm(); assert.equal(await f.run(), true);
  assert.deepEqual(f.result(), { quits: 1, dialogs: 2 });
});
test('export is protected both before and after an active-session confirmation', async () => {
  const f = await fixture(); f.state({ exporting: true }); await assert.rejects(f.run(), /导出/);
  f.state({ exporting: false, live: true }); f.confirm(); f.race(); await assert.rejects(f.run(), /导出/);
  assert.equal(f.result().quits, 0);
});
