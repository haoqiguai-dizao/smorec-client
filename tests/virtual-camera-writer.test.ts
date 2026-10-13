import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { build } from 'esbuild';
import type { VirtualCameraWriter } from '../electron/services/live/virtual-camera';

const bundle = build({ entryPoints: [path.resolve('electron/services/live/virtual-camera.ts')], bundle: true, write: false,
  platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });

class Child extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  bytes = 0;
  constructor() {
    super(); this.stdin.on('data', bytes => { this.bytes += bytes.length; });
    this.stdin.once('finish', () => this.finish(0));
  }
  ready(): void { this.stdout.write('{"event":"ready"}\n'); }
  finish(code: number): void {
    if (this.exitCode !== null) return;
    this.exitCode = code; this.stdout.end(); this.stderr.end(); this.emit('exit', code); this.emit('close', code);
  }
  kill(): void { this.finish(1); }
}

async function fixture() {
  let child: Child | undefined;
  const errors: Error[] = [];
  const module = { exports: {} }, require = createRequire(import.meta.url);
  const testRequire = (name: string) => name === 'electron' ? { app: { getAppPath: () => path.resolve('synthetic-app') } }
    : name === 'node:fs' ? { existsSync: () => true }
      : name === 'node:child_process' ? { spawn: () => (child = new Child()), execFile: () => { throw new Error('Command execution forbidden'); } }
        : require(name);
  new Function('require', 'module', 'exports', 'process', (await bundle).outputFiles[0].text)(testRequire, module, module.exports,
    { ...process, resourcesPath: path.resolve('synthetic-resources') });
  const Writer = (module.exports as { VirtualCameraWriter: typeof VirtualCameraWriter }).VirtualCameraWriter;
  return { writer: new Writer(error => errors.push(error)), child: () => child!, errors };
}

test('stopping while the virtual camera starts rejects the pending start without waiting for its timeout', async () => {
  const item = await fixture();
  const starting = item.writer.start(4, 4, 30);
  const rejected = assert.rejects(starting, /启动已取消/);
  await assert.rejects(item.writer.write(new ArrayBuffer(64)), /尚未就绪/);
  await item.writer.stop(); await rejected;
  assert.equal(item.child().exitCode, 0); assert.deepEqual(item.errors, []);
});

test('a bridge exit before ready rejects startup and reports failure', async () => {
  const item = await fixture();
  const starting = item.writer.start(4, 4, 30);
  const rejected = assert.rejects(starting, /已停止/);
  item.child().finish(23);
  await rejected; await item.writer.stop();
  assert.equal(item.errors.length, 1);
});

test('valid frames write their exact bytes only after ready, and normal stop does not report failure', async () => {
  const item = await fixture();
  const starting = item.writer.start(4, 4, 30); item.child().ready(); await starting;
  await item.writer.write(new ArrayBuffer(64));
  assert.equal(item.child().bytes, 64);
  await item.writer.stop(); assert.deepEqual(item.errors, []);
  await assert.rejects(item.writer.write(new ArrayBuffer(64)), /尚未就绪/);
});

test('invalid frame buffers and duplicate starts never write to the live bridge', async () => {
  const item = await fixture();
  const starting = item.writer.start(4, 4, 30); item.child().ready(); await starting;
  await assert.rejects(item.writer.start(4, 4, 30), /已在运行/);
  for (const frame of [new ArrayBuffer(60), Buffer.alloc(64), null]) await assert.rejects(item.writer.write(frame), /输出帧无效/);
  assert.equal(item.child().bytes, 0); await item.writer.stop();
});

test('a stopped writer can start a new bridge without retaining its stopping flag', async () => {
  const item = await fixture();
  let starting = item.writer.start(4, 4, 30); item.child().ready(); await starting; await item.writer.stop();
  starting = item.writer.start(4, 4, 30); item.child().ready(); await starting;
  await item.writer.write(new ArrayBuffer(64)); assert.equal(item.child().bytes, 64); await item.writer.stop();
});
