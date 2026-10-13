import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { StreamProfile, StreamProfileSummary } from '../../../shared/streaming';
import { parseStreamProfile, profileID } from './validation';

type LegacyProfile = Omit<StreamProfileSummary, 'needsCredentials'> & { credentials: string };
type Stored = StreamProfile | LegacyProfile;
interface Loaded { version: 1 | 2; records: Stored[]; raw?: string }

function parseStored(value: unknown, version: 1 | 2): Stored {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
  const item = value as Record<string, unknown>;
  if ('credentials' in item) {
    if (typeof item.credentials !== 'string' || item.credentials.length > 30000 || 'server' in item || 'key' in item) throw new Error();
    const { credentials, ...settings } = item;
    const { server: _server, key: _key, ...summary } = parseStreamProfile({ ...settings, server: 'rtmp://localhost/live', key: '' });
    return { ...summary, id: profileID(summary.id), credentials };
  }
  if (version !== 2) throw new Error();
  const profile = parseStreamProfile(item);
  return { ...profile, id: profileID(profile.id) };
}

function summarize(value: Stored): StreamProfileSummary {
  const { id, name, resolution, fps, bitrate, keyframeSeconds } = value;
  return { id, name, resolution, fps, bitrate, keyframeSeconds, ...('credentials' in value ? { needsCredentials: true } : {}) };
}

export class StreamProfiles {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private directory: () => string) {}
  private file(): string { return path.join(this.directory(), 'stream-profiles.json'); }
  private async load(): Promise<Loaded> {
    let raw: string;
    try { raw = await fs.readFile(this.file(), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 2, records: [] }; throw new Error('读取推流配置失败', { cause: error }); }
    try {
      if (raw.length > 1024 * 1024) throw new Error();
      const data = JSON.parse(raw);
      if (![1, 2].includes(data.version) || !Array.isArray(data.profiles) || data.profiles.length > 50) throw new Error();
      const records: Stored[] = data.profiles.map((item: unknown) => parseStored(item, data.version));
      if (new Set(records.map(item => item.id)).size !== records.length) throw new Error();
      return { version: data.version, records, raw };
    } catch { throw new Error('推流配置文件损坏，请检查或恢复配置'); }
  }
  async list(): Promise<StreamProfileSummary[]> {
    await this.pending;
    return (await this.load()).records.map(summarize);
  }
  async read(value: unknown): Promise<StreamProfile> {
    const id = profileID(value);
    await this.pending;
    const record = (await this.load()).records.find(item => item.id === id);
    if (!record) throw new Error('推流配置不存在，请重新选择');
    if ('credentials' in record) throw new Error('旧连接请重新填写地址和密钥，保存后无需钥匙串授权');
    return record;
  }
  save(value: unknown): Promise<StreamProfileSummary> {
    const draft = parseStreamProfile(value);
    return this.change(async records => {
      const id = draft.id ?? randomUUID();
      const at = records.findIndex(item => item.id === id);
      if (draft.id && at < 0) throw new Error('推流配置已删除，请重新创建');
      if (at < 0 && records.length >= 50) throw new Error('最多保存 50 个推流配置');
      const next: StreamProfile = { ...draft, id };
      if (at < 0) records.push(next); else records[at] = next;
      return summarize(next);
    });
  }
  remove(value: unknown): Promise<void> {
    const id = profileID(value);
    return this.change(async records => { const at = records.findIndex(item => item.id === id); if (at >= 0) records.splice(at, 1); });
  }
  private async preserveLegacy(loaded: Loaded): Promise<void> {
    if (loaded.version !== 1 || loaded.raw === undefined) return;
    const hash = createHash('sha256').update(loaded.raw).digest('hex').slice(0, 16);
    const backup = path.join(this.directory(), `stream-profiles.encrypted-v1.${hash}.json`);
    try { await fs.writeFile(backup, loaded.raw, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await fs.readFile(backup, 'utf8') !== loaded.raw)
        throw new Error('备份旧推流配置失败，原配置未改动', { cause: error });
    }
  }
  private change<T>(update: (records: Stored[]) => Promise<T>): Promise<T> {
    const work = this.pending.then(async () => {
      const loaded = await this.load(), result = await update(loaded.records);
      await fs.mkdir(this.directory(), { recursive: true, mode: 0o700 });
      await this.preserveLegacy(loaded);
      const temporary = this.file() + '.' + randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 2, profiles: loaded.records }), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, this.file());
      } finally { await fs.rm(temporary, { force: true }); }
      return result;
    });
    this.pending = work.catch(() => undefined);
    return work;
  }
}
