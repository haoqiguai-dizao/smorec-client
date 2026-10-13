import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import type { SpeechSession } from '../electron/services/whiteboard/speech-session';

async function fixture(shared = false, recognition = '', platform = 'darwin') {
  const clients: FakeClient[] = [], removed: string[] = [];
  const timers = new Map<number, () => void>();
  let serial = 0, modelReady: Promise<boolean> = Promise.resolve(true);
  class FakeClient {
    disposed = false;
    commands: { command: string; extra?: Record<string, unknown> }[] = [];
    resolve?: () => void;
    reject?: (error: Error) => void;
    constructor() { clients.push(this); }
    request(command: string, extra?: Record<string, unknown>) {
      this.commands.push({ command, extra });
      if (command === 'recording-dictation-cancel') return Promise.resolve();
      if (command.endsWith('dictation-stop')) return Promise.resolve({ duration: 1 });
      return new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    }
    dispose() { this.disposed = true; this.reject?.(new Error('语音录入已取消')); }
    isRunning() { return !this.disposed; }
    async shutdownGracefully() { this.dispose(); }
  }
  const injected = { NativeClient: FakeClient, model: () => modelReady, recognition,
    fs: { mkdtemp: async () => `/tmp/dictation-${++serial}`, rm: async (directory: string) => { removed.push(directory); } } };
  const bundled = await build({ entryPoints: ['electron/services/whiteboard/speech-session.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'speech-fixture', setup(builder) {
      builder.onResolve({ filter: /^(electron|node:fs|node:child_process|\.\.\/native-client|\.\/speech-model|\.\/speech-worker|\.\.\/diagnostics|\.\.\/ffmpeg)$/ },
        args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents:
        path === 'electron' ? 'export const app={getPath:()=>"/tmp"};'
          : path === 'node:fs' ? 'export const promises=injected.fs;'
            : path === 'node:child_process' ? 'export const execFile=(...args)=>args.at(-1)(null,"","");'
            : path === '../native-client' ? 'export const NativeClient=injected.NativeClient;'
              : path === './speech-model' ? 'export class SpeechModel { ready(){return injected.model()} }'
                : path === './speech-worker' ? 'export class SpeechWorker { async warm(){} async recognize(){return injected.recognition} close(){} }'
                  : path === '../ffmpeg' ? 'export const ffmpegPath=()=>"unused";'
                    : 'export const diagnostic=()=>{};' }));
    } }] });
  const module = { exports: {} as { SpeechSession: typeof SpeechSession } };
  new Function('require', 'module', 'exports', 'injected', 'process', 'setTimeout', 'clearTimeout', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, injected, { platform },
    (callback: () => void, ms: number) => { assert.equal(ms, 8000); const id = ++serial; timers.set(id, callback); return id; },
    (id: number) => timers.delete(id));
  const capture = shared ? new FakeClient() : undefined;
  const session = new module.exports.SpeechSession(capture as never);
  if (shared) session.setDevice('selected-mic', true);
  return { session, clients, removed, timers,
    model: (value: Promise<boolean>) => { modelReady = value; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('Windows and Mac dictation return labels without a final stop, while retaining decimals and internal sentences', async () => {
  for (const platform of ['win32', 'darwin']) {
    const { session, clients, removed } = await fixture(false, ' 版本 0.9.69。继续测试。 ', platform);
    const starting = session.start(); await settle(); clients[0].resolve!(); const id = await starting;
    assert.equal(await session.stop(id), '版本 0.9.69。继续测试'); assert.equal(removed.length, 1);
    assert.equal(clients[0].disposed, true);
  }
});

test('a stalled microphone times out, releases its helper and allows a clean retry', async () => {
  const { session, clients, timers } = await fixture();
  const first = session.start(); const failure = assert.rejects(first, /8 秒/);
  await settle(); assert.equal(clients.length, 1);
  [...timers.values()][0](); await failure;
  assert.equal(clients[0].disposed, true);
  const next = session.start(); await settle(); clients[1].resolve!();
  assert.match(await next, /^[0-9a-f-]{36}$/); await session.cancel();
  assert.equal(timers.size, 0);
});

test('cancel does not await microphone startup and a late old reply cannot cancel its replacement', async () => {
  const { session, clients } = await fixture();
  const first = session.start(); const failure = assert.rejects(first, /取消/);
  await settle(); const old = clients[0];
  await session.cancel(); assert.equal(old.disposed, true);
  const next = session.start(); await settle();
  old.resolve!(); await failure;
  assert.equal(clients[1].disposed, false);
  clients[1].resolve!(); await next; await session.cancel();
});

test('cancel while checking the model never creates a late microphone process', async () => {
  const { session, clients, model } = await fixture();
  let resolve!: (value: boolean) => void;
  model(new Promise<boolean>(done => { resolve = done; }));
  const start = session.start(); const failure = assert.rejects(start, /取消/);
  await session.cancel(); resolve(true); await failure;
  assert.equal(clients.length, 0);
});

test('concurrent press requests do not open the microphone twice', async () => {
  const { session, clients } = await fixture();
  const first = session.start(); await assert.rejects(session.start(), /正在录音/);
  await settle(); assert.equal(clients.length, 1);
  clients[0].resolve!(); await first; await session.cancel();
});

test('recording dictation reuses the open microphone and cancel never disposes the recorder', async () => {
  const { session, clients } = await fixture(true);
  const first = session.start(); await settle();
  assert.equal(clients.length, 1);
  assert.equal(clients[0].commands[0].command, 'recording-dictation-start');
  clients[0].resolve!(); const id = await first;
  await session.cancel();
  assert.equal(clients[0].disposed, false);
  assert.deepEqual(clients[0].commands[1], { command: 'recording-dictation-cancel', extra: { dictationId: id } });
  const retry = session.start(); await settle(); clients[0].resolve!();
  assert.notEqual(await retry, id); await session.cancel();
});

test('timeout of shared dictation scopes cleanup to its clip and keeps screen recording alive', async () => {
  const { session, clients, timers } = await fixture(true);
  const first = session.start(); const failure = assert.rejects(first, /8 秒/);
  await settle(); const oldReply = clients[0].resolve!;
  [...timers.values()][0](); await failure;
  assert.equal(clients[0].disposed, false);
  const oldId = clients[0].commands[0].extra!.dictationId;
  const next = session.start(); await settle();
  oldReply(); await settle();
  assert.equal(clients[0].commands.at(-1)!.extra!.dictationId, oldId);
  clients[0].resolve!(); await next; await session.cancel();
  assert.equal(clients[0].disposed, false);
});

test('cleanup after screen recording has ended never respawns the native helper', async () => {
  const { session, clients } = await fixture(true);
  const start = session.start(); await settle(); clients[0].resolve!(); await start;
  clients[0].disposed = true;
  await session.cancel();
  assert.equal(clients[0].commands.length, 1);
});
