import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import type { SpawnOptions } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { audioEncoderIdentity, audioSourceHash } from '../electron/services/audio-fingerprint';
import { storeFloatWave } from '../electron/services/audio-storage';
import { floatPcmMetrics, floatPcmStream } from '../electron/services/audio-pcm-process';
import { compressedWaveResponse, floatWaveHeader } from '../electron/services/audio-wave-response';
import { MicrophoneEffectsCache } from '../electron/services/microphone-effects/cache';
import { ProjectAudioMixCache } from '../electron/services/project-audio/cache';
import { AudioCacheManager } from '../electron/services/audio-cache-manager';
import { microphonePreset } from '../shared/microphone-effects';
import { readWaveInfo } from '../electron/services/microphone-effects/wave';
import { writeSyntheticWave } from './fixtures/microphone-audio';
import { runMicrophoneProcess } from '../electron/services/microphone-effects/process';

const root = path.resolve('output/audio-storage-tests'); await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, 'run-'));
const signal = () => new AbortController().signal;
const source = path.join(directory, 'original.wav');
await writeSyntheticWave(source, 48000, 2, 48000 + 17, (frame, channel) => .2 * Math.sin(frame * (channel ? .03 : .07)));
const sourceBytes = (await fs.readFile(source)).subarray(44), packed = path.join(directory, 'original.wv');
const stored = await storeFloatWave(source, packed, ffmpeg!, await readWaveInfo(source), signal());
assert.equal(stored.file, packed);
test('float lossless storage keeps samples, signed zeros, subnormals and finite overrange unchanged', async () => {
  assert.ok((await fs.stat(packed)).size < (await fs.stat(source)).size);
  assert.equal((await floatPcmMetrics(ffmpeg!, packed, await readWaveInfo(packed))).hash, stored.storage.pcmHash);
  const edge = path.join(directory, 'edges.wav'), bytes = await fs.readFile(source);
  const patterns = [0, 0x80000000, 1, 0x80000001, 0x00800000, 0x80800000, 0x3fa00000, 0xbfa00000];
  for (let offset = 44; offset < bytes.length; offset += 4) bytes.writeUInt32LE(patterns[((offset - 44) / 4) % patterns.length], offset);
  await fs.writeFile(edge, bytes);
  const encoded = await storeFloatWave(edge, edge + '.wv', ffmpeg!, await readWaveInfo(edge), signal());
  assert.equal(encoded.storage.format, 'wavpack-float32');
  assert.equal((await floatPcmMetrics(ffmpeg!, encoded.file, await readWaveInfo(encoded.file))).hash, encoded.storage.pcmHash);
});
test('encoder mtime changes reuse both real caches; source changes still invalidate the source memo', async () => {
  const executable = path.join(directory, process.platform === 'win32' ? 'encoder.exe' : 'encoder'); await fs.copyFile(ffmpeg!, executable); await fs.chmod(executable, 0o755);
  const effects = new MicrophoneEffectsCache({ directory: path.join(directory, 'effects'), executable: () => executable });
  const mix = new ProjectAudioMixCache({ directory: path.join(directory, 'mix'), executable: () => executable });
  try {
    const identity = await audioEncoderIdentity(executable), effect = await effects.resolve(source, microphonePreset('natural'));
    const inputs = [{ path: source, volume: .5 }, { path: effect, volume: 1 }], mixed = await mix.resolve(inputs, 1);
    const stat = await fs.stat(executable); await fs.utimes(executable, stat.atime, new Date(stat.mtimeMs + 2000));
    assert.equal(await audioEncoderIdentity(executable), identity);
    assert.equal(await effects.resolve(source, microphonePreset('natural')), effect); assert.equal(await mix.resolve(inputs, 1), mixed);
    const copy = path.join(directory, 'change.wav'); await fs.copyFile(source, copy); const before = await audioSourceHash(copy);
    const bytes = await fs.readFile(copy); bytes.writeFloatLE(.7, 44); await fs.writeFile(copy, bytes);
    assert.notEqual(await audioSourceHash(copy), before);
  } finally { effects.dispose(); mix.dispose(); }
});
test('virtual float WAV serves header, suffix and unaligned sample ranges exactly, and releases workers', async () => {
  const expected = Buffer.concat([floatWaveHeader(await readWaveInfo(packed)), sourceBytes]);
  for (const range of [undefined, 'bytes=0-43', 'bytes=43-51', 'bytes=8001-18002', 'bytes=-17', 'bytes=384053-']) {
    let released = false;
    const response = await compressedWaveResponse(packed, new Request('https://test/audio', { headers: range ? { Range: range } : {} }), ffmpeg!, {}, () => { released = true; });
    const bytes = Buffer.from(await response.arrayBuffer());
    const start = Number(response.headers.get('Content-Range')?.match(/bytes (\d+)-/)?.[1] ?? 0);
    assert.ok(bytes.equals(expected.subarray(start, start + bytes.length)), range ?? 'complete file'); assert.equal(released, true);
  }
  for (const range of ['bytes=-0', 'bytes=999999-', 'bytes=5-4', 'bytes=1-2,5-6']) {
    let released = false;
    assert.equal((await compressedWaveResponse(packed, new Request('https://test/audio', { headers: { Range: range } }), ffmpeg!, {}, () => { released = true; })).status, 416);
    assert.equal(released, true);
  }
  const large = floatWaveHeader({ channels: 2, sampleRate: 48000, samples: 48000 * 14400 });
  assert.equal(large.toString('ascii', 0, 4), 'RF64'); assert.equal(large.readBigUInt64LE(28), BigInt(48000 * 14400 * 8));
  let released = false;
  const response = await compressedWaveResponse(packed, new Request('https://test/audio'), ffmpeg!, {}, () => { released = true; });
  await response.body!.cancel();
  const until = Date.now() + 5000; while (!released && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(released, true);
});
test('decoder failure, cancellation and concurrent range reads do not poison later readers', async () => {
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(floatPcmStream(ffmpeg!, packed, await readWaveInfo(packed), 0, 48000, aborted.signal), { name: 'AbortError' });
  const failed = await floatPcmStream(path.join(directory, 'missing-decoder'), packed, await readWaveInfo(packed));
  await assert.rejects(async () => { for await (const chunk of failed.stream) void chunk; }); await failed.closed;
  await Promise.all(Array.from({ length: 9 }, async (_, index) => {
    const response = await compressedWaveResponse(packed, new Request('https://test/audio', { headers: { Range: `bytes=${44 + index * 17}-${5000 + index * 17}` } }), ffmpeg!, {}, () => {});
    assert.equal((await response.arrayBuffer()).byteLength, 4957);
  }));
});
test('compression failure and unsupported layouts preserve the original float WAV', async () => {
  const fallback = await storeFloatWave(source, path.join(directory, 'failed.wv'), process.execPath, await readWaveInfo(source), signal());
  assert.equal(fallback.file, source); assert.equal(fallback.storage.format, 'wave-float32');
  const multichannel = path.join(directory, 'multichannel.wav'); await writeSyntheticWave(multichannel, 48000, 6, 4800, (frame, channel) => Math.sin(frame * .1) * channel * .01);
  const result = await storeFloatWave(multichannel, multichannel + '.wv', ffmpeg!, await readWaveInfo(multichannel), signal());
  assert.equal(result.file, multichannel); assert.equal(result.storage.format, 'wave-float32');
});
test('canceling during compression preserves another consumer, cleans an interrupted job and permits retry', async t => {
  const marker = path.join(directory, 'compression-started'), executable = path.join(directory, 'delayed-encoder.mjs');
  await fs.writeFile(executable, `#!${process.execPath}\nimport { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes('wavpack')) { writeFileSync(${JSON.stringify(marker)}, 'started'); await new Promise(resolve => setTimeout(resolve, 600)); }
const child = spawn(${JSON.stringify(ffmpeg)}, args, { stdio: 'inherit' });
child.once('error', () => process.exit(1)); child.once('close', code => process.exit(code ?? 1));
`);
  await fs.chmod(executable, 0o755);
  // Launch the delayed JS fixture with Node on both platforms; FFmpeg stays real.
  const childProcess = createRequire(import.meta.url)('node:child_process') as typeof import('node:child_process');
  const spawn = childProcess.spawn;
  t.mock.method(childProcess, 'spawn', (command: string, args: readonly string[] = [], options: SpawnOptions = {}) =>
    command === executable ? spawn(process.execPath, [executable, ...args], options) : spawn(command, args, options));
  syncBuiltinESMExports();
  const cacheDirectory = path.join(directory, 'compression-cancel');
  const effects = new MicrophoneEffectsCache({ directory: cacheDirectory, executable: () => executable });
  async function until(check: () => Promise<boolean>) {
    const deadline = Date.now() + 10000;
    while (!await check()) { assert.ok(Date.now() < deadline, 'Compression must settle'); await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  try {
    const first = new AbortController(), canceled = effects.resolve(source, microphonePreset('natural'), first.signal);
    const rejected = assert.rejects(canceled, { name: 'AbortError' });
    const retained = effects.resolve(source, microphonePreset('natural'));
    await until(async () => !!await fs.stat(marker).catch(() => undefined)); first.abort(); await rejected;
    assert.ok((await retained).endsWith('.wv'));
    await fs.rm(marker);
    const second = new AbortController(), interrupted = effects.resolve(source, microphonePreset('warm'), second.signal);
    const failed = assert.rejects(interrupted, { name: 'AbortError' });
    await until(async () => !!await fs.stat(marker).catch(() => undefined)); second.abort(); await failed;
    await until(async () => !(await fs.readdir(cacheDirectory)).some(name => name.includes('.part.')));
    assert.ok((await effects.resolve(source, microphonePreset('warm'))).endsWith('.wv'));
    assert.equal((await fs.readdir(cacheDirectory)).some(name => name.includes('.part.')), false);
  } finally { effects.dispose(); t.mock.restoreAll(); syncBuiltinESMExports(); }
});
test('legacy WAV results remain readable without migration, while newly generated inactive mixes expire safely', async () => {
  let clock = Date.now(); const manager = new AudioCacheManager(path.join(directory, 'lifecycle'), { recentMs: 10 }, () => clock);
  const effects = new MicrophoneEffectsCache({ directory: path.join(directory, 'lifecycle', 'microphone-effects'), executable: () => ffmpeg!, maintenance: manager });
  const mix = new ProjectAudioMixCache({ directory: path.join(directory, 'lifecycle', 'project-audio'), executable: () => ffmpeg!, maintenance: manager });
  const lease = manager.lease();
  try {
    const effect = await effects.resolve(source, microphonePreset('natural'), undefined, lease);
    const mixed = await mix.resolve([{ path: source, volume: 1 }, { path: effect, volume: 1 }], 1, undefined, lease);
    assert.ok(mixed.endsWith('.wav'));
    assert.equal(JSON.parse(await fs.readFile(mixed + '.json', 'utf8')).storage.format, 'wave-float32');
    clock += 100; await manager.maintain(); assert.ok(await fs.stat(mixed));
    lease.release(); await manager.ready(); clock += 100; await manager.maintain();
    await assert.rejects(fs.stat(mixed)); assert.ok(await fs.stat(effect));
    const legacy = effect.replace(/\.wv$/, '.wav');
    await runMicrophoneProcess(ffmpeg!, ['-y', '-i', effect, '-c:a', 'pcm_f32le', legacy], signal());
    const metadata = JSON.parse(await fs.readFile(effect + '.json', 'utf8')); delete metadata.storage;
    await fs.writeFile(legacy + '.json', JSON.stringify(metadata)); await fs.rm(effect);
    assert.equal(await effects.resolve(source, microphonePreset('natural')), legacy);
    assert.ok(await fs.stat(source));
  } finally { lease.release(); effects.dispose(); mix.dispose(); manager.dispose(); }
});
