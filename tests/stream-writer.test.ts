import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { DEFAULT_STREAM_ENCODING, type StreamConnection } from '../shared/streaming';
import type { StreamWriter } from '../electron/services/streaming/writer';

type Written = (error?: Error | null) => void;
interface ControlledChild extends EventEmitter {
  stdin: EventEmitter & { write(value: Buffer, done: Written): void; end(): void; destroyed: boolean };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill(signal?: string): void;
  exitCode: number | null;
  signalCode: string | null;
}
async function fixture(ignoreTerminate = false) {
  let now = 0, blocked = true, videoWrites = 0, audioWrites = 0;
  const pending: Written[] = [], pulses = new Set<() => void>();
  const wakes = new Set<() => void>();
  const timers = new Map<object, { at: number; callback: () => void }>();
  const states: StreamConnection[] = [];
  const children: ControlledChild[] = [];
  const io = {
    spawn: () => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(),
        exitCode: null as number | null, signalCode: null as string | null,
        stdin: Object.assign(new EventEmitter(), { destroyed: false,
          write: (_value: Buffer, done: Written) => { videoWrites++; if (blocked) pending.push(done); else done(); },
          end: () => { child.kill(); },
        }),
        kill: (signal = 'SIGTERM') => { if (ignoreTerminate && signal !== 'SIGKILL') return;
          child.signalCode = signal; child.emit('close'); },
      });
      children.push(child); return child;
    },
    audio: () => ({ destroyed: false, write: (_value: Buffer, done: Written) => { audioWrites++; done(); }, end: () => {}, destroy: () => {} }),
  };
  const bundled = await build({ entryPoints: [path.resolve('electron/services/streaming/writer.ts')], bundle: true,
    write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{
      name: 'controlled-stream-io', setup(builder) {
        builder.onResolve({ filter: /^(node:child_process|node:readline|\.\/encoder|\.\/audio-channel)$/ }, args => ({ path: args.path, namespace: 'stream-io' }));
        builder.onLoad({ filter: /.*/, namespace: 'stream-io' }, args => ({ loader: 'js', contents:
          args.path === 'node:child_process' ? 'export const spawn = (...args) => controlledIO.spawn(...args);'
            : args.path === 'node:readline' ? 'export const createInterface = ({ input }) => input;'
              : args.path === './encoder' ? "export const chooseStreamEncoder = async () => 'libx264';"
                : "export class StreamAudioChannel { socket = controlledIO.audio(); async open() { return 'private-fixture'; } async close() { this.socket.destroy(); } }",
        }));
      },
    }] });
  const module = { exports: {} };
  const later = (callback: () => void, delay: number) => {
    const id = {}; timers.set(id, { at: now + delay, callback }); return id;
  };
  new Function('require', 'module', 'exports', 'controlledIO', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'setImmediate', bundled.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports, io, { now: () => now },
    (callback: () => void) => { pulses.add(callback); return callback; },
    (callback: () => void) => pulses.delete(callback), later, (id: object) => timers.delete(id),
    (callback: () => void) => wakes.add(callback),
  );
  const Writer = (module.exports as { StreamWriter: typeof StreamWriter }).StreamWriter;
  const writer = new Writer({ executable: 'controlled-encoder', profile: { ...DEFAULT_STREAM_ENCODING,
    id: 'fixture', name: 'fixture', server: 'rtmp://example.test/live', key: 'fixture' },
    changed: state => states.push(state), failed: error => { throw error; },
  });
  await writer.start(2, 2, 30);
  writer.audio(Buffer.alloc(48000 * 8 / 2), 0); await writer.write(new ArrayBuffer(16), .4);
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    for (const pulse of [...pulses]) pulse();
  };
  const flushWakes = () => {
    for (let count = 0; wakes.size; count++) {
      assert.ok(count < 100, 'The event-driven sender must settle when no data is due');
      const callback = wakes.values().next().value!; wakes.delete(callback); callback();
    }
  };
  return { writer, states, children, advance, pending, flushWakes, queuedWakes: () => wakes.size,
    written: () => videoWrites, writtenAudio: () => audioWrites, unblock: () => {
    blocked = false; for (const done of pending.splice(0)) done();
  } };
}

test('a cold encoder may take 750 ms while only one video write is outstanding', async () => {
  const f = await fixture();
  try {
    f.advance(0); f.advance(750);
    assert.equal(f.pending.length, 1, 'Slow initialization must not queue raw video frames');
    assert.ok(f.writtenAudio() > f.written(), 'PCM must continue while the encoder waits before draining video');
    assert.ok(f.states.every(state => state.status === 'connecting'));
    f.unblock();
    for (let at = 0; at < 12; at++) f.advance(0);
    assert.equal(f.children.length, 1, 'Cold startup must use the same encoder connection');
    assert.ok(f.written() > 1, 'Input must resume when the cold encoder drains its pending write');
    assert.ok(f.states.every(state => state.status !== 'reconnecting'));
  } finally { await f.writer.stop(); }
});

test('draining a pipe wakes due media immediately without waiting for another pacing poll', async () => {
  const f = await fixture();
  try {
    f.advance(0); f.advance(250);
    assert.equal(f.written(), 1); assert.equal(f.pending.length, 1);
    f.unblock(); f.flushWakes();
    assert.equal(f.written(), 2, 'Drain must send the current slot without replaying every missed input slot');
    assert.equal(f.children.length, 1); assert.equal(f.pending.length, 0);
    assert.equal(f.queuedWakes(), 0);
  } finally { await f.writer.stop(); }
});
test('media wakeups coalesce and a queued wake cannot write after stop', async () => {
  const f = await fixture();
  for (let frame = 0; frame < 20; frame++) await f.writer.write(new ArrayBuffer(16), .4);
  assert.equal(f.queuedWakes(), 1);
  await f.writer.stop(); const video = f.written(), audio = f.writtenAudio(); f.flushWakes();
  assert.equal(f.written(), video); assert.equal(f.writtenAudio(), audio);
});

test('a permanently blocked startup still disconnects at the existing connection timeout', async () => {
  const f = await fixture();
  try {
    f.advance(0); f.advance(19999);
    assert.ok(f.states.every(state => state.status === 'connecting'));
    f.advance(1);
    assert.equal(f.states.at(-1)?.status, 'reconnecting');
    assert.equal(f.states.at(-1)?.attempt, 1);
    assert.equal(f.pending.length, 1);
  } finally { await f.writer.stop(); }
});
test('a connected encoder recovers a two-second write stall without reconnecting or queueing video', async () => {
  const f = await fixture();
  try {
    f.advance(0);
    f.children[0].stdout.emit('line', 'frame=1');
    f.children[0].stdout.emit('line', 'progress=continue');
    assert.equal(f.states.at(-1)?.status, 'streaming');
    f.advance(2000);
    assert.equal(f.states.at(-1)?.status, 'streaming');
    assert.equal(f.pending.length, 1);
    f.unblock();
    for (let at = 0; at < 12; at++) f.advance(0);
    assert.ok(f.written() > 1);
    assert.equal(f.children.length, 1);
    assert.ok(f.states.every(state => state.status !== 'reconnecting'));
  } finally { await f.writer.stop(); }
});
test('advancing encoder frames tolerate pending writes while unchanged progress cannot hide a stall', async () => {
  const f = await fixture();
  const progress = (frame: number) => {
    f.children[0].stdout.emit('line', 'frame=' + frame);
    f.children[0].stdout.emit('line', 'progress=continue');
  };
  try {
    f.advance(0); progress(1);
    for (let frame = 2; frame <= 15; frame++) { f.advance(1000); progress(frame); }
    assert.equal(f.states.at(-1)?.status, 'streaming');
    assert.equal(f.pending.length, 1, 'Pending video must remain bounded despite continuing progress');
    for (let second = 0; second < 9; second++) { f.advance(1000); progress(15); }
    assert.equal(f.states.at(-1)?.status, 'streaming');
    f.advance(1000);
    assert.equal(f.states.at(-1)?.status, 'reconnecting');
    assert.equal(f.states.at(-1)?.attempt, 1);
    assert.match(f.states.at(-1)?.error ?? '', /编码输出已停止更新/);
  } finally { await f.writer.stop(); }
});
test('successful input writes cannot hide ten seconds without encoded frame progress', async () => {
  const f = await fixture();
  try {
    f.unblock(); f.advance(0);
    f.children[0].stdout.emit('line', 'frame=1'); f.children[0].stdout.emit('line', 'progress=continue');
    f.advance(9999);
    assert.equal(f.states.at(-1)?.status, 'streaming');
    f.advance(1);
    assert.equal(f.states.at(-1)?.status, 'reconnecting');
  } finally { await f.writer.stop(); }
});
test('an encoder exit still reconnects immediately without waiting for the progress watchdog', async () => {
  const f = await fixture();
  try {
    f.advance(0);
    f.children[0].stdout.emit('line', 'frame=1'); f.children[0].stdout.emit('line', 'progress=continue');
    f.children[0].kill();
    assert.equal(f.states.at(-1)?.status, 'reconnecting');
    assert.equal(f.states.at(-1)?.attempt, 1);
  } finally { await f.writer.stop(); }
});
test('feeding PCM for a blocked video pipe cannot get more than half a second ahead', async () => {
  const f = await fixture();
  try {
    f.writer.audio(Buffer.alloc(24000 * 8), .5);
    f.advance(0);
    for (let step = 0; step < 30; step++) f.advance(33.34);
    assert.equal(f.pending.length, 1);
    assert.ok(f.writtenAudio() > 1, 'Audio must supply complete demuxer packets while video is pending');
    assert.ok(f.writtenAudio() - f.written() <= 15, 'The PCM lead must stay bounded to 500 ms at 30 fps');
  } finally { await f.writer.stop(); }
});
test('stop forcibly reaps an encoder that ignores graceful shutdown and SIGTERM', async () => {
  const f = await fixture(true);
  const stopping = f.writer.stop();
  assert.equal(f.children[0].signalCode, null);
  f.advance(2000); await stopping;
  assert.equal(f.children[0].signalCode, 'SIGKILL');
});
