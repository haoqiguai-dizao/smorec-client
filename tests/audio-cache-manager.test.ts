import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { AudioCacheManager } from '../electron/services/audio-cache-manager';
import { MicrophoneEffectsCache } from '../electron/services/microphone-effects/cache';
import { ProjectAudioMixCache } from '../electron/services/project-audio/cache';
import { microphonePreset } from '../shared/microphone-effects';
import { writeSyntheticWave } from './fixtures/microphone-audio';
import { readWaveInfo } from '../electron/services/microphone-effects/wave';

const root = path.resolve('output/audio-cache-tests'); await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, 'run-')), evidence: unknown[] = [];
const hash = async (file: string) => createHash('sha256').update(await fs.readFile(file)).digest('hex');
test.after(async () => { await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify({ syntheticOnly: true, evidence }, null, 2)); });
async function fixture(name: string, policy = {}) {
  const location = path.join(directory, name); let time = Date.now();
  const manager = new AudioCacheManager(path.join(location, 'cache'), policy, () => time);
  await fs.mkdir(path.join(location, 'cache', 'microphone-effects'), { recursive: true });
  const original = path.join(location, 'original.wav'); await fs.writeFile(original, 'original audio content');
  return { location, manager, original, now: () => time, tick: (ms: number) => { time += ms; },
    async entry(key: string, size = 200, kind = 'microphone-effects') {
      const file = path.join(location, 'cache', kind, `${key.repeat(64)}.wav`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, Buffer.alloc(size, 42)); await fs.writeFile(`${file}.json`, '{}');
      await manager.published(file, await manager.sourcesFor(original, await hash(original)));
      return file;
    } };
}

test('manual cleaning retires legacy and missing-source caches, preserves active outputs and original media; is idempotent', async () => {
  const f = await fixture('safety');
  try {
    const active = await f.entry('a'), removable = await f.entry('b'), missing = await f.entry('c');
    const lostSource = path.join(f.location, 'lost.wav'); await fs.copyFile(f.original, lostSource);
    await f.manager.published(missing, await f.manager.sourcesFor(lostSource, await hash(lostSource))); await fs.unlink(lostSource);
    const changed = await f.entry('d'), changedSource = path.join(f.location, 'changed.wav'); await fs.copyFile(f.original, changedSource);
    await f.manager.published(changed, await f.manager.sourcesFor(changedSource, await hash(changedSource)));
    const before = await fs.stat(changedSource); await fs.writeFile(changedSource, 'changed! audio content'); await fs.utimes(changedSource, before.atime, before.mtime);
    const legacy = path.join(path.dirname(active), `${'e'.repeat(64)}.wav`); await fs.writeFile(legacy, 'legacy');
    const unrelated = path.join(path.dirname(active), 'user-file.wav'); await fs.writeFile(unrelated, 'unknown');
    const originalHash = await hash(f.original), lease = f.manager.lease(); lease.pin(active);
    const state = await f.manager.state(); assert.ok(state.inUseBytes > 0); assert.ok(state.protectedBytes > 0); assert.ok(state.clearableBytes > 0);
    assert.equal(state.totalBytes, state.clearableBytes + state.protectedBytes + state.inUseBytes);
    const cleaned = await f.manager.clear(); assert.ok(cleaned.freedBytes > 0); await assert.rejects(fs.stat(removable), { code: 'ENOENT' });
    for (const file of [missing, changed, legacy]) await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    for (const file of [active, unrelated, changedSource]) assert.ok((await fs.stat(file)).isFile());
    assert.equal(await hash(f.original), originalHash); assert.equal((await f.manager.clear()).freedBytes, 0);
    lease.release(); lease.release(); assert.ok((await f.manager.clear()).freedBytes > 0);
    evidence.push({ test: 'safety-idempotency', state, cleaned: cleaned.freedBytes, originalsUnchanged: true });
  } finally { f.manager.dispose(); }
});

test('combined budget evicts least recently used cache outputs to target, then expires idle results', async () => {
  // The budget includes provenance JSON with absolute paths. Leave metadata headroom
  // so a different checkout path cannot make the single protected entry exceed it.
  const targetBytes = 80 * 1024, size = 64 * 1024;
  const f = await fixture('budget', { maxBytes: 160 * 1024, targetBytes, recentMs: 100, maxIdleMs: 10000 });
  try {
    const first = await f.entry('a', size); f.tick(101); const second = await f.entry('b', size, 'project-audio'); f.tick(101);
    const recent = await f.entry('c', size); const result = await f.manager.maintain();
    assert.ok(result.freedBytes > 0); assert.ok((await f.manager.state()).totalBytes <= targetBytes);
    await assert.rejects(fs.stat(first), { code: 'ENOENT' }); await assert.rejects(fs.stat(second), { code: 'ENOENT' }); assert.ok(await fs.stat(recent));
    f.tick(10001); assert.ok((await f.manager.maintain()).freedBytes > 0);
    evidence.push({ test: 'budget-lru-expiry', result });
  } finally { f.manager.dispose(); }
});

test('a cache hit updates recency and adopts legacy results only after real DSP validation', async () => {
  const f = await fixture('legacy-hit', { maxIdleMs: 1000 });
  const source = path.join(f.location, 'signal.wav'); await writeSyntheticWave(source, 48000, 1, 4800, frame => .1 * Math.sin(frame * .03));
  const options = { directory: path.join(f.location, 'cache', 'microphone-effects'), executable: () => ffmpeg! };
  const legacy = new MicrophoneEffectsCache(options), managed = new MicrophoneEffectsCache({ ...options, maintenance: f.manager });
  try {
    const output = await legacy.resolve(source, microphonePreset('natural')), digest = await hash(output);
    assert.ok((await f.manager.state()).clearableBytes > 0);
    const lease = f.manager.lease(); assert.equal(await managed.resolve(source, microphonePreset('natural'), undefined, lease), output);
    lease.release(); assert.ok((await f.manager.state()).clearableBytes > 0);
    f.tick(900); assert.equal(await managed.resolve(source, microphonePreset('natural')), output);
    f.tick(900); assert.equal((await f.manager.maintain()).freedBytes, 0); assert.equal(await hash(output), digest);
    f.tick(101); assert.ok((await f.manager.maintain()).freedBytes > 0);
    evidence.push({ test: 'legacy-adoption-reuse', identicalPcmHash: digest });
  } finally { legacy.dispose(); managed.dispose(); f.manager.dispose(); }
});

test('mix provenance points to original stems, allowing independent cleanup and exact regeneration', async () => {
  const f = await fixture('flattened');
  const source = path.join(f.location, 'signal.wav'); await writeSyntheticWave(source, 48000, 1, 9600, frame => .08 * Math.sin(frame * .03));
  const effects = new MicrophoneEffectsCache({ directory: path.join(f.location, 'cache', 'microphone-effects'), executable: () => ffmpeg!, maintenance: f.manager });
  const mix = new ProjectAudioMixCache({ directory: path.join(f.location, 'cache', 'project-audio'), executable: () => ffmpeg!, maintenance: f.manager });
  try {
    const lease = f.manager.lease(), processed = await effects.resolve(source, microphonePreset('natural'), undefined, lease);
    const inputs = [{ path: source, volume: .5 }, { path: processed, volume: .75 }];
    const output = await mix.resolve(inputs, .2, undefined, lease), digest = await hash(output);
    const record = JSON.parse(await fs.readFile(`${output}.lifecycle.json`, 'utf8'));
    assert.ok(record.sources.every((item: { path: string }) => item.path === source));
    assert.equal((await f.manager.clear()).freedBytes, 0); lease.release();
    assert.ok((await f.manager.clear()).freedBytes > 0); await assert.rejects(fs.stat(processed), { code: 'ENOENT' }); await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    const next = f.manager.lease(), fresh = await effects.resolve(source, microphonePreset('natural'), undefined, next);
    const remixed = await mix.resolve([{ ...inputs[0] }, { ...inputs[1], path: fresh }], .2, undefined, next);
    assert.equal(await hash(remixed), digest); next.release();
    evidence.push({ test: 'flattened-provenance-regeneration', identicalPcmHash: digest });
  } finally { effects.dispose(); mix.dispose(); f.manager.dispose(); }
});

test('cleaning during generation, shared cancellation and repeated clear requests never remove a leased output', async () => {
  const f = await fixture('concurrency');
  const source = path.join(f.location, 'signal.wav'); await writeSyntheticWave(source, 48000, 2, 48000 * 20, frame => .1 * Math.sin(frame * .03));
  const mix = new ProjectAudioMixCache({ directory: path.join(f.location, 'cache', 'project-audio'), executable: () => ffmpeg!, maintenance: f.manager });
  try {
    const canceled = new AbortController(), lease = f.manager.lease(), inputs = [{ path: source, volume: 1 }, { path: source, volume: .5 }];
    const first = mix.resolve(inputs, 20, canceled.signal), rejects = assert.rejects(first, { name: 'AbortError' });
    const second = mix.resolve(inputs, 20, undefined, lease);
    const deadline = Date.now() + 10000;
    while (!(await fs.readdir(path.join(f.location, 'cache', 'project-audio')).catch(() => [])).some(file => file.endsWith('.part.wav'))) {
      assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5));
    }
    const cleaning = Promise.all([f.manager.clear(), f.manager.clear(), f.manager.maintain()]); canceled.abort(); await rejects;
    const output = await second; await cleaning; assert.equal((await readWaveInfo(output)).samples, 48000 * 20);
    assert.equal((await f.manager.clear()).freedBytes, 0); lease.release(); assert.ok((await f.manager.clear()).freedBytes > 0);
    assert.equal((await fs.readdir(path.dirname(output))).some(file => file.includes('.part.')), false);
    evidence.push({ test: 'concurrent-clear-shared-job', validSamples: 48000 * 20 });
  } finally { mix.dispose(); f.manager.dispose(); }
});

test('abandoned partials expire with or without markers; active jobs and fresh partials remain', async () => {
  const f = await fixture('partials', { abandonedMs: 1000 });
  try {
    const dir = path.join(f.location, 'cache', 'microphone-effects');
    const make = async (key: string, marked: boolean) => {
      const file = path.join(dir, `${key.repeat(64)}.${randomUUID()}.part.wav`);
      if (marked) await f.manager.beginWork(file);
      await fs.writeFile(file, 'incomplete');
      for (const item of [file, ...(marked ? [`${file}.work.json`] : [])]) await fs.utimes(item, new Date(f.now()), new Date(f.now()));
      return file;
    };
    const expired = await make('a', true), active = await make('b', true), unknown = await make('c', false);
    const orphan = await make('e', true); await fs.unlink(orphan);
    const lease = f.manager.lease(); lease.pin(path.join(dir, `${'b'.repeat(64)}.wav`)); f.tick(1100);
    const fresh = await make('d', true); await f.manager.maintain();
    await assert.rejects(fs.stat(expired), { code: 'ENOENT' });
    await assert.rejects(fs.stat(`${orphan}.work.json`), { code: 'ENOENT' });
    await assert.rejects(fs.stat(unknown), { code: 'ENOENT' });
    for (const file of [active, fresh]) assert.ok(await fs.stat(file));
    lease.release(); await f.manager.maintain(); await assert.rejects(fs.stat(active), { code: 'ENOENT' });
  } finally { f.manager.dispose(); }
});

test('symlinked directories and original media remain untouched when cache provenance is malformed', async () => {
  const f = await fixture('symlinks'), aliasDirectory = path.join(directory, 'source-alias');
  try {
    const file = await f.entry('a');
    let linked = path.join(f.location, 'linked-original.wav');
    if (process.platform === 'win32') {
      await fs.symlink(f.location, aliasDirectory, 'junction');
      linked = path.join(aliasDirectory, path.basename(f.original));
    } else await fs.symlink(f.original, linked);
    assert.notEqual(linked, await fs.realpath(linked));
    const recordFile = `${file}.lifecycle.json`, record = JSON.parse(await fs.readFile(recordFile, 'utf8'));
    record.sources = [{ path: linked, hash: await hash(f.original) }]; await fs.writeFile(recordFile, JSON.stringify(record));
    assert.ok((await f.manager.clear()).freedBytes > 0); await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    assert.ok(await fs.stat(f.original));
    const malformed = await f.entry('b');
    await fs.writeFile(`${malformed}.lifecycle.json`, JSON.stringify({ ...record, sources: [] }));
    assert.ok((await f.manager.clear()).freedBytes > 0); await assert.rejects(fs.stat(malformed), { code: 'ENOENT' });
    const other = path.join(f.location, 'outside'); await fs.mkdir(other); await fs.writeFile(path.join(other, 'precious.wav'), 'preserve');
    await fs.symlink(other, path.join(f.location, 'cache', 'project-audio'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await f.manager.clear(); assert.ok(result.snapshot.warnings.length); assert.equal(await fs.readFile(path.join(other, 'precious.wav'), 'utf8'), 'preserve');
    evidence.push({ test: 'symlink-malformed-protection', warnings: result.snapshot.warnings });
  } finally {
    f.manager.dispose();
    if (process.platform === 'win32') await fs.unlink(aliasDirectory).catch(() => {});
  }
});

test('automatic maintenance defers during capture/export and resumes when idle', async () => {
  const f = await fixture('busy', { maxIdleMs: 100 });
  try {
    const file = await f.entry('a'); f.tick(101);
    f.manager.setMaintenanceAllowed(() => false); assert.equal((await f.manager.maintain()).freedBytes, 0); assert.ok(await fs.stat(file));
    assert.equal((await f.manager.clear()).freedBytes, 0);
    f.manager.setMaintenanceAllowed(() => true); assert.ok((await f.manager.maintain()).freedBytes > 0);
  } finally { f.manager.dispose(); }
});

test('idle caches with missing or unknown sources are reclaimed below budget, preserving active and fresh outputs', async () => {
  const f = await fixture('orphans', { recentMs: 100, maxIdleMs: 10000 });
  try {
    const missing = await f.entry('a'), active = await f.entry('b');
    const legacy = path.join(path.dirname(missing), `${'c'.repeat(64)}.wav`);
    await fs.writeFile(legacy, 'legacy'); await fs.utimes(legacy, new Date(f.now()), new Date(f.now()));
    await fs.unlink(f.original);
    const lease = f.manager.lease(); lease.pin(active);
    assert.equal((await f.manager.maintain()).freedBytes, 0);
    f.tick(101);
    const fresh = path.join(path.dirname(missing), `${'d'.repeat(64)}.wav`);
    await fs.writeFile(fresh, 'fresh'); await fs.utimes(fresh, new Date(f.now()), new Date(f.now()));
    assert.ok((await f.manager.maintain()).freedBytes > 0);
    for (const file of [missing, legacy]) await assert.rejects(fs.stat(file), { code: 'ENOENT' });
    for (const file of [active, fresh]) assert.ok(await fs.stat(file));
    lease.release(); await f.manager.ready();
    assert.equal((await f.manager.maintain()).freedBytes, 0);
    f.tick(101); assert.ok((await f.manager.maintain()).freedBytes > 0);
    assert.equal((await f.manager.state()).totalBytes, 0);
  } finally { f.manager.dispose(); }
});

test('orphaned generated sidecars are reclaimable, while arbitrary files and file symlinks remain', async () => {
  const f = await fixture('orphan-sidecars', { recentMs: 100 });
  try {
    const file = await f.entry('a'); await fs.unlink(file);
    for (const sidecar of [`${file}.json`, `${file}.lifecycle.json`]) await fs.utimes(sidecar, new Date(f.now()), new Date(f.now()));
    const unrelated = path.join(path.dirname(file), 'original.wav'); await fs.writeFile(unrelated, 'original');
    const link = path.join(path.dirname(file), `${'b'.repeat(64)}.wav`);
    await fs.symlink(f.original, link);
    f.tick(101); assert.ok((await f.manager.maintain()).freedBytes > 0);
    await assert.rejects(fs.stat(`${file}.json`), { code: 'ENOENT' });
    await assert.rejects(fs.stat(`${file}.lifecycle.json`), { code: 'ENOENT' });
    assert.ok((await fs.lstat(link)).isSymbolicLink()); assert.equal(await fs.readFile(unrelated, 'utf8'), 'original');
    assert.equal(await fs.readFile(f.original, 'utf8'), 'original audio content');
  } finally { f.manager.dispose(); }
});

test('closing a disposable source through a path alias cleans only its own results before removing the original', async () => {
  const f = await fixture('trial-alias'), aliasDirectory = path.join(directory, 'trial-alias-link');
  try {
    const removable = await f.entry('a'), kept = await f.entry('b');
    const another = path.join(f.location, 'another.wav'); await fs.writeFile(another, 'different audio');
    await f.manager.published(kept, await f.manager.sourcesFor(another, await hash(another)));
    let alias = path.join(f.location, 'original-alias.wav');
    if (process.platform === 'win32') {
      await fs.symlink(f.location, aliasDirectory, 'junction');
      alias = path.join(aliasDirectory, path.basename(f.original));
    } else await fs.symlink(f.original, alias);
    assert.notEqual(alias, await fs.realpath(alias));
    const digest = await hash(f.original); assert.ok((await f.manager.clearForSource(alias)).freedBytes > 0);
    await assert.rejects(fs.stat(removable), { code: 'ENOENT' }); assert.ok(await fs.stat(kept)); assert.equal(await hash(f.original), digest);
  } finally {
    f.manager.dispose();
    if (process.platform === 'win32') await fs.unlink(aliasDirectory).catch(() => {});
  }
});

test('finishing a long preview/export renews recency instead of immediately expiring a just-used result', async () => {
  const f = await fixture('long-use', { maxIdleMs: 1000 });
  try {
    const file = await f.entry('a'), lease = f.manager.lease(); lease.pin(file); f.tick(2000);
    assert.equal((await f.manager.maintain()).freedBytes, 0); lease.release();
    assert.equal((await f.manager.maintain()).freedBytes, 0); assert.ok(await fs.stat(file));
    f.tick(1001); assert.ok((await f.manager.maintain()).freedBytes > 0);
  } finally { f.manager.dispose(); }
});

test('Mac/Windows Cache directory case aliases are counted without following a symlink', { skip: !['darwin', 'win32'].includes(process.platform) }, async () => {
  const location = path.join(directory, 'case-alias');
  const upper = path.join(location, 'Cache', 'microphone-effects'); await fs.mkdir(upper, { recursive: true });
  const lower = path.join(location, 'cache', 'microphone-effects');
  if (!await fs.stat(lower).catch(() => undefined)) return; // Case-sensitive volumes have no alias.
  const manager = new AudioCacheManager(path.join(location, 'cache'));
  try {
    const legacy = path.join(upper, `${'a'.repeat(64)}.wav`); await fs.writeFile(legacy, 'legacy');
    const state = await manager.state(); assert.equal(state.totalBytes, 6); assert.equal(state.clearableBytes, 6); assert.deepEqual(state.warnings, []);
    assert.equal((await manager.clear()).freedBytes, 6);
    await fs.writeFile(legacy, 'legacy');
    const source = path.join(location, 'source.wav'); await fs.writeFile(source, 'original');
    await manager.published(legacy, await manager.sourcesFor(source, await hash(source)));
    const lease = manager.lease(); lease.pin(legacy); assert.equal((await manager.clear()).freedBytes, 0);
    lease.release(); assert.ok((await manager.clear()).freedBytes > 0);
  } finally { manager.dispose(); }
});
