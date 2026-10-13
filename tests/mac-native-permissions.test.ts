import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { build } from 'esbuild';
import type { NativeClient } from '../electron/services/native-client';

async function fixture(platform = 'darwin', startStateError?: string, stalledCommand?: string) {
  let granted = false;
  let expire: (() => void) | undefined;
  const children: (EventEmitter & { commands: string[]; closed: boolean })[] = [];
  const spawn = () => {
    // Each process caches the permission at creation, matching the regression.
    const cachedPermission = granted;
    const child = Object.assign(new EventEmitter(), { pid: children.length + 1, exitCode: null as number | null,
      killed: false, closed: false, commands: [] as string[], stdout: new PassThrough(), stderr: new PassThrough(),
      stdin: undefined as unknown as Writable, kill() { this.killed = true; close(); } });
    const close = () => {
      child.closed = true; child.exitCode = 0;
      child.stdout.end(); child.stderr.end(); child.emit('exit', 0); child.emit('close', 0);
    };
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      const request = JSON.parse(chunk.toString()); child.commands.push(request.command);
      if (request.command === stalledCommand) { done(); return; }
      if (request.command === 'start' && startStateError) {
        child.stdout.write(JSON.stringify({ event: 'state', state: { status: 'error', error: startStateError } }) + '\n');
        done(); return;
      }
      child.stdout.write(JSON.stringify({ id: request.id, ok: true, data: { inputPermission: cachedPermission, screenPermission: cachedPermission } }) + '\n'); done();
    }, final(done) { queueMicrotask(close); done(); } });
    children.push(child); return child;
  };
  const bundled = await build({ entryPoints: ['electron/services/native-client.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'native-fixture', setup(builder) {
      builder.onResolve({ filter: /^(electron|node:child_process|node:fs|\.\/diagnostics)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'electron'
        ? 'export const app={getAppPath:()=>"/source",on:()=>{}}; export const BrowserWindow={getAllWindows:()=>[],getFocusedWindow:()=>null};' : path === 'node:child_process'
          ? 'export const spawn=injected.spawn;' : path === 'node:fs' ? 'export const existsSync=()=>true; export const {mkdtempSync, chmodSync, rmSync, realpathSync}=injected.filesystem;'
            : 'export const diagnostic=()=>{};' }));
    } }] });
  const module = { exports: {} as { NativeClient: typeof NativeClient } };
  new Function('require', 'module', 'exports', 'injected', 'process', 'setTimeout', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, { spawn, filesystem: createRequire(import.meta.url)('node:fs') },
    { platform, pid: 100, env: {}, resourcesPath: '/App/Contents/Resources' },
    (callback: () => void, ms: number) => {
      if (stalledCommand && ms === 7000) { expire = callback; return undefined; }
      return setTimeout(callback, ms);
    });
  return { client: new module.exports.NativeClient(), children, grant: () => { granted = true; }, expire: () => expire!() };
}

test('Mac native state errors reject a pending start immediately', async () => {
  const message = '流播放期间，应用程序连接中断而导致失败';
  const { client } = await fixture('darwin', message);
  try {
    await assert.rejects(client.request('start'), new Error(message));
  } finally { client.dispose(); }
});

test('Mac source probes check permission in the same fresh helper before a potential system prompt', async () => {
  const { client, children, grant } = await fixture();
  try {
    await client.request('sources');
    assert.deepEqual(children[0].commands, ['capabilities', 'sources']);
    assert.equal(children[0].closed, true);
    grant();
    await client.request('live-applications');
    assert.deepEqual(children[1].commands, ['capabilities', 'live-applications']);
    assert.equal(children[1].closed, true);
  } finally { client.dispose(); }
});

test('Mac permission refresh observes a new grant and never recycles an active recording', async () => {
  const { client, children, grant } = await fixture();
  try {
    assert.equal((await client.request<{ inputPermission: boolean }>('capabilities')).inputPermission, false);
    assert.equal(children[0].closed, true);
    grant();
    assert.equal((await client.request<{ inputPermission: boolean }>('capabilities')).inputPermission, true);
    await client.request('start'); const capture = children.at(-1)!;
    await client.request('capabilities'); await client.request('microphone-devices');
    assert.equal(capture.closed, false);
    await client.request('audio-mute');
    assert.deepEqual(capture.commands, ['start', 'audio-mute']);
    await client.request('stop'); assert.equal(capture.closed, true);
    await client.request('start'); assert.notEqual(children.at(-1), capture);
  } finally { client.dispose(); }
});

for (const [start, stop] of [['live-start', 'live-stop'], ['microphone-trial-start', 'microphone-trial-stop']]) {
  test(`Mac ${start} uses a new process after the previous session ends`, async () => {
    const { client, children } = await fixture();
    try {
      await client.request(start); const first = children[0];
      await client.request(stop); assert.equal(first.closed, true);
      await client.request(start); assert.equal(children.length, 2);
    } finally { client.dispose(); }
  });
}

test('Windows retains its existing shared helper lifecycle', async () => {
  const { client, children } = await fixture('win32');
  try {
    await client.request('sources'); await client.request('start'); await client.request('stop');
    assert.equal(children.length, 1); assert.equal(children[0].closed, false);
  } finally { client.dispose(); }
});

test('whiteboard timeout never ends the shared recorder or emits a recording failure', async () => {
  const { client, children, expire } = await fixture('darwin', undefined, 'recording-dictation-start');
  const states: unknown[] = []; client.onState = state => states.push(state);
  try {
    await client.request('start');
    const pending = client.request('recording-dictation-start');
    const failure = assert.rejects(pending, /屏幕录制继续/);
    expire(); await failure;
    assert.equal(children[0].closed, false); assert.equal(states.length, 0);
    await client.request('recording-dictation-cancel'); await client.request('audio-mute');
    assert.equal(children.length, 1);
    await client.request('stop'); assert.equal(children[0].closed, true);
  } finally { client.dispose(); }
});
