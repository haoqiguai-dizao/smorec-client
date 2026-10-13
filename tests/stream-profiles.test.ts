import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { StreamProfiles } from '../electron/services/streaming/profiles';
import { DEFAULT_STREAM_ENCODING } from '../shared/streaming';
import { parseStreamProfile, streamDestination } from '../electron/services/streaming/validation';

const draft = { ...DEFAULT_STREAM_ENCODING, name: 'Owned fixture', server: 'rtmps://example.test/live', key: 'sensitive-owned-test-key' };
test('profiles persist plaintext across restart, restrict file access and update only requested profiles', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'xiaolu-stream-profiles-'));
  const store = new StreamProfiles(() => directory);
  try {
    const [one, two] = await Promise.all([store.save(draft), store.save({ ...draft, name: 'Second fixture' })]);
    const raw = await readFile(path.join(directory, 'stream-profiles.json'), 'utf8');
    assert.ok(raw.includes(draft.key)); assert.ok(raw.includes(draft.server)); assert.equal(JSON.parse(raw).version, 2);
    if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, 'stream-profiles.json'))).mode & 0o777, 0o600);
    const restarted = new StreamProfiles(() => directory);
    assert.equal((await restarted.list()).length, 2); assert.equal((await restarted.read(one.id)).key, draft.key);
    const summaries = JSON.stringify(await store.list());
    assert.ok(!summaries.includes(draft.key)); assert.ok(!summaries.includes(draft.server));
    await store.save({ ...draft, id: one.id, bitrate: 6000 }); assert.equal((await store.read(one.id)).bitrate, 6000);
    await store.remove(one.id); assert.deepEqual((await store.list()).map(item => item.id), [two.id]);
    await assert.rejects(store.read(one.id), /不存在/); await assert.rejects(store.save({ ...draft, id: one.id }), /已删除/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('legacy records need no keychain access, remain recoverable and are replaced by the same profile ID', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'xiaolu-stream-legacy-'));
  const file = path.join(directory, 'stream-profiles.json');
  const records = ['First legacy', 'Second legacy'].map(name => ({ ...DEFAULT_STREAM_ENCODING, id: randomUUID(), name,
    credentials: Buffer.from('owned-legacy-ciphertext-' + name).toString('base64') }));
  const raw = JSON.stringify({ version: 1, profiles: records }, null, 2);
  await writeFile(file, raw);
  const store = new StreamProfiles(() => directory);
  try {
    assert.deepEqual((await store.list()).map(item => item.needsCredentials), [true, true]);
    await assert.rejects(store.read(records[0].id), /重新填写/);
    assert.equal(await readFile(file, 'utf8'), raw);
    assert.deepEqual(await readdir(directory), ['stream-profiles.json']);
    await store.save({ ...draft, id: records[0].id, name: records[0].name });
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.version, 2); assert.equal(saved.profiles[0].key, draft.key);
    assert.deepEqual(saved.profiles[1], records[1]);
    assert.deepEqual((await store.list()).map(item => item.needsCredentials), [undefined, true]);
    await assert.rejects(store.read(records[1].id), /重新填写/);
    const backups = (await readdir(directory)).filter(name => name.startsWith('stream-profiles.encrypted-v1.'));
    assert.equal(backups.length, 1); assert.equal(await readFile(path.join(directory, backups[0]), 'utf8'), raw);
    if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, backups[0]))).mode & 0o777, 0o600);
    await store.save({ ...draft, id: records[1].id, name: records[1].name });
    const restarted = new StreamProfiles(() => directory);
    assert.equal((await restarted.read(records[1].id)).key, draft.key);
    assert.equal((await restarted.list()).length, 2);
    assert.equal((await readdir(directory)).filter(name => name.startsWith('stream-profiles.encrypted-v1.')).length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('invalid files and duplicate IDs cannot be overwritten by a new save', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'xiaolu-stream-invalid-'));
  const file = path.join(directory, 'stream-profiles.json'), profile = { ...draft, id: randomUUID() };
  const store = new StreamProfiles(() => directory);
  try {
    for (const raw of ['{', JSON.stringify({ version: 3, profiles: [] }),
      JSON.stringify({ version: 2, profiles: [profile, profile] }),
      JSON.stringify({ version: 2, profiles: [{ ...profile, credentials: 'ambiguous' }] }),
      JSON.stringify({ version: 2, profiles: [{ ...profile, key: 42 }] }),
      JSON.stringify({ version: 2, profiles: [{ ...profile, unknown: true }] })]) {
      await writeFile(file, raw);
      await assert.rejects(store.save(draft), /损坏/);
      assert.equal(await readFile(file, 'utf8'), raw);
    }
    await writeFile(file, JSON.stringify({ version: 2, profiles: [] }));
    assert.ok((await store.save(draft)).id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('a failed legacy backup preserves the source and does not poison later saves', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'xiaolu-stream-backup-'));
  const file = path.join(directory, 'stream-profiles.json');
  const raw = JSON.stringify({ version: 1, profiles: [{ ...DEFAULT_STREAM_ENCODING, id: randomUUID(), name: 'Legacy', credentials: 'opaque' }] });
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 16);
  const backup = path.join(directory, `stream-profiles.encrypted-v1.${hash}.json`);
  const store = new StreamProfiles(() => directory);
  try {
    await writeFile(file, raw); await writeFile(backup, 'Unrelated existing file');
    await assert.rejects(store.save(draft), /备份旧推流配置失败/);
    assert.equal(await readFile(file, 'utf8'), raw); assert.equal(await readFile(backup, 'utf8'), 'Unrelated existing file');
    await rm(backup); await store.save(draft);
    assert.equal(await readFile(backup, 'utf8'), raw);
    assert.equal((await store.list()).length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('invalid profiles cannot launch protocols, files or shell commands through the destination', () => {
  for (const server of ['file:///private/file', 'https://example.test', 'rtmp://example.test/live\n-command', 'rtmp://example.test/live#x'])
    assert.throws(() => parseStreamProfile({ ...draft, server }));
  assert.throws(() => parseStreamProfile({ ...draft, fps: '30' }));
  assert.throws(() => parseStreamProfile({ ...draft, bitrate: 100000 }));
  assert.throws(() => parseStreamProfile({ ...draft, id: '../file' }));
  assert.equal(streamDestination('rtmp://example.test/live/', 'nested/key?token=123'), 'rtmp://example.test/live/nested/key?token=123');
  assert.equal(streamDestination('rtmps://example.test/live/key?token=123', ''), 'rtmps://example.test/live/key?token=123');
});
