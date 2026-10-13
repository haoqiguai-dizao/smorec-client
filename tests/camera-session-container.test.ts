import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import type { CameraManager } from '../electron/services/camera';

async function fixture(run: (manager: CameraManager, root: string) => Promise<void>) {
  const output = path.resolve('output'); await fs.mkdir(output, { recursive: true });
  const root = await fs.mkdtemp(path.join(output, 'camera-session-container-'));
  const bundled = await build({ entryPoints: [path.resolve('electron/services/camera.ts')], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent', plugins: [{ name: 'isolated-camera', setup(builder) {
      builder.onResolve({ filter: /^electron$|^\.\/diagnostics$|^\.\/ffmpeg$/ }, args => ({ path: args.path, namespace: 'camera-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'camera-test' }, args => ({ loader: 'js', contents: args.path === 'electron'
        ? `export const app={getPath(){return ${JSON.stringify(root)}}};`
        : args.path === './diagnostics' ? 'export const diagnostic=()=>{};'
          : 'export const ffmpegPath=()=>{throw Error("No codec process in unit tests")}; export const probeMedia=async()=>{throw Error("No probe in unit tests")};' }));
    } }] });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  const Manager = (module.exports as { CameraManager: typeof CameraManager }).CameraManager, manager = new Manager();
  try { await run(manager, root); }
  finally {
    await manager.dispose();
    const resolved = await fs.realpath(root), relative = path.relative(output, resolved);
    assert.ok(relative.startsWith('camera-session-container-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
    assert.equal((await fs.lstat(root)).isSymbolicLink(), false);
    await fs.rm(resolved, { recursive: true, force: true });
  }
}

test('main process rejects bytes before MIME ACK, then accepts a split MP4 header without changing formats', async () => {
  await fixture(async (manager, root) => {
    const { id } = await manager.prepare(), starting = manager.start(id);
    const file = path.join(root, 'camera-staging', id, 'camera.part');
    await assert.rejects(manager.append(id, new Uint8Array([0, 0, 0, 32]).buffer), /尚未确认/);
    assert.equal((await fs.stat(file)).size, 0);
    assert.throws(() => manager.started(id, Date.now(), 'video/mp4;codecs=vp8'), /不受支持/);
    await assert.rejects(manager.append(id, new Uint8Array([0]).buffer), /尚未确认/);
    manager.started(id, Date.now(), 'video/mp4;codecs=avc1.420034'); await starting;
    assert.throws(() => manager.started(id, Date.now(), 'video/webm;codecs=vp8'), /顺序/);
    const prefix = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]);
    await manager.append(id, prefix.slice(0, 6).buffer);
    await assert.rejects(manager.append(id, new Uint8Array([0, 0]).buffer), /不匹配/);
    assert.equal((await fs.stat(file)).size, 6);
    await manager.append(id, prefix.slice(6).buffer); await manager.finish(id);
    assert.deepEqual(new Uint8Array(await fs.readFile(file)), prefix);
  });
});

test('legacy two-argument start stays WebM and rejects an MP4 body before writing any bytes', async () => {
  await fixture(async (manager, root) => {
    const { id } = await manager.prepare(), starting = manager.start(id);
    manager.started(id, Date.now()); await starting;
    const file = path.join(root, 'camera-staging', id, 'camera.part');
    await assert.rejects(manager.append(id, new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112]).buffer), /不匹配/);
    assert.equal((await fs.stat(file)).size, 0);
    const prefix = new Uint8Array([26, 69, 223, 163]);
    for (const byte of prefix) await manager.append(id, new Uint8Array([byte]).buffer);
    await manager.finish(id); assert.deepEqual(new Uint8Array(await fs.readFile(file)), prefix);
  });
});
