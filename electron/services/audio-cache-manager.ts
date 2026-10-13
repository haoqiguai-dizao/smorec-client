import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AUDIO_CACHE_POLICY, type AudioCacheCleanup, type AudioCacheSnapshot } from '../../shared/audio-cache';

export interface AudioCacheSource { path: string; hash: string }
interface RecordData { schema: 1; key: string; bytes: number; createdAt: number; lastAccessAt: number; sources: AudioCacheSource[]; transient?: boolean }
interface Entry { file: string; files: string[]; bytes: number; access: number; sources?: AudioCacheSource[]; partial?: boolean; transient?: boolean; disposable?: boolean; owner?: string }
interface Scan { entries: Entry[]; microphoneBytes: number; mixBytes: number; warnings: string[] }
type Policy = { [K in keyof typeof AUDIO_CACHE_POLICY]: number };
const outputName = /^[a-f0-9]{64}\.(wav|wv)$/;
const partName = /^[a-f0-9]{64}\.[a-f0-9-]{36}\.part\.wav$/;
const sidecarName = /^([a-f0-9]{64}\.(?:wav|wv))\.(?:json|lifecycle\.json)$/;
const hashPattern = /^[a-f0-9]{64}$/;
const comparable = (file: string) => process.platform === 'win32' || process.platform === 'darwin' ? file.toLowerCase() : file;
type Removal = Pick<AudioCacheCleanup, 'freedBytes' | 'removedFiles'>;

export class AudioCacheLease {
  private files = new Set<string>();
  private released = false;
  constructor(private manager: AudioCacheManager) {}
  pin(file: string): void {
    if (this.released) throw new Error('声音缓存使用已结束');
    file = path.resolve(file);
    if (!this.files.has(file)) { this.manager.pin(file); this.files.add(file); }
  }
  release(): void {
    if (this.released) return;
    this.released = true;
    for (const file of this.files) this.manager.unpin(file);
    this.files.clear();
  }
}

/** Only this service's exact cache files can be removed. Original media is read-only. */
export class AudioCacheManager {
  private directories: string[];
  private pins = new Map<string, number>();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private scheduledAt = Infinity;
  private disposed = false;
  private maintenanceAllowed = () => true;
  private cleanupWarnings: string[] = [];
  private nextMaintenanceDelay = 6 * 60 * 60 * 1000;
  readonly policy: Policy;
  constructor(root: string, policy: Partial<Policy> = {}, private now = () => Date.now()) {
    this.directories = ['microphone-effects', 'project-audio'].map(name => path.resolve(root, name));
    this.policy = { ...AUDIO_CACHE_POLICY, ...policy };
  }
  lease(): AudioCacheLease { return new AudioCacheLease(this); }
  pin(file: string): void { file = comparable(path.resolve(file)); this.pins.set(file, (this.pins.get(file) ?? 0) + 1); }
  unpin(file: string): void {
    const canonical = path.resolve(file), key = comparable(canonical), count = this.pins.get(key) ?? 0;
    if (count <= 1) {
      this.pins.delete(key);
      if (count) void this.touch(canonical, this.now()).catch(() => {});
    } else this.pins.set(key, count - 1);
    this.schedule();
  }
  private owned(file: string): boolean {
    return this.directories.some(directory => comparable(directory) === comparable(path.dirname(path.resolve(file)))) && outputName.test(path.basename(file));
  }
  setMaintenanceAllowed(check: () => boolean): void { this.maintenanceAllowed = check; }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task); this.queue = next.catch(() => {}); return next;
  }
  /** Pin first, then await ongoing deletion before looking up a cache hit. */
  async ready(): Promise<void> { await this.queue; }
  private sources(value: unknown): value is AudioCacheSource[] {
    return Array.isArray(value) && value.length > 0 && value.length <= 16 && value.every(source =>
      source && typeof source.path === 'string' && path.isAbsolute(source.path) && hashPattern.test(source.hash)
      && !this.directories.some(directory => comparable(source.path) === comparable(directory)
        || comparable(source.path).startsWith(`${comparable(directory)}${path.sep}`)));
  }
  private async record(file: string): Promise<RecordData | undefined> {
    try {
      const sidecar = `${file}.lifecycle.json`, stat = await fs.lstat(sidecar);
      if (!stat.isFile() || stat.size > 64 * 1024) return;
      const data = JSON.parse(await fs.readFile(sidecar, 'utf8')) as RecordData;
      if (data.schema === 1 && data.key === path.parse(file).name && Number.isSafeInteger(data.bytes) && data.bytes >= 0
        && Number.isFinite(data.createdAt) && Number.isFinite(data.lastAccessAt) && this.sources(data.sources)) return data;
    } catch { /* Provenance is optional for disposable cache outputs. */ }
  }
  async sourcesFor(file: string, hash: string): Promise<AudioCacheSource[]> {
    if (this.owned(file)) return (await this.record(file))?.sources ?? [];
    const canonical = await fs.realpath(file);
    return this.sources([{ path: canonical, hash }]) ? [{ path: canonical, hash }] : [];
  }
  async published(file: string, sources: AudioCacheSource[], transient = false): Promise<void> {
    if (!this.owned(file) || !this.sources(sources)) return;
    await this.serial(async () => {
      const previous = await this.record(file), stat = await fs.lstat(file);
      if (!stat.isFile()) return;
      const timestamp = this.now();
      const data: RecordData = { schema: 1, key: path.parse(file).name, bytes: stat.size,
        createdAt: previous?.createdAt ?? timestamp, lastAccessAt: timestamp, sources,
        ...(transient || previous?.transient ? { transient: true } : {}) };
      await this.writeRecord(file, data);
    });
    this.schedule();
  }
  private async writeRecord(file: string, data: RecordData): Promise<void> {
    const temporary = `${file}.${randomUUID()}.lifecycle.part.json`;
    try { await fs.writeFile(temporary, JSON.stringify(data), { flag: 'wx' }); await fs.rename(temporary, `${file}.lifecycle.json`); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  private async touch(file: string, timestamp: number): Promise<void> {
    if (this.disposed || !this.owned(file)) return;
    await this.serial(async () => {
      const data = await this.record(file);
      if (data) await this.writeRecord(file, { ...data, lastAccessAt: Math.max(data.lastAccessAt, timestamp) });
    });
  }
  async beginWork(file: string): Promise<void> {
    if (!this.directories.includes(path.dirname(file)) || !partName.test(path.basename(file))) throw new Error('声音缓存临时路径无效');
    await fs.writeFile(`${file}.work.json`, JSON.stringify({ schema: 1, startedAt: this.now() }), { flag: 'wx' });
  }
  schedule(delay = 1000): void {
    if (this.disposed || this.scheduledAt <= Date.now() + delay) return;
    clearTimeout(this.timer); this.scheduledAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      this.timer = undefined; this.scheduledAt = Infinity;
      if (!this.maintenanceAllowed()) { this.schedule(60 * 1000); return; }
      void this.maintain().catch(() => {}).finally(() => this.schedule(this.nextMaintenanceDelay));
    }, delay);
    this.timer.unref();
  }
  dispose(): void { this.disposed = true; clearTimeout(this.timer); }

  private async scan(): Promise<Scan> {
    const entries: Entry[] = [], totals = [0, 0], warnings: string[] = [];
    for (const [index, directory] of this.directories.entries()) {
      try {
        const dir = await fs.lstat(directory);
        if (!dir.isDirectory() || comparable(await fs.realpath(directory)) !== comparable(directory)) throw new Error('缓存目录不是普通目录');
        const files = new Map<string, { size: number; mtimeMs: number }>();
        for (const name of await fs.readdir(directory)) {
          const file = path.join(directory, name), stat = await fs.lstat(file).catch(() => undefined);
          if (stat?.isFile()) { files.set(file, stat); totals[index] += stat.size; }
          else warnings.push('部分缓存路径无法安全读取，已保留');
        }
        const claimed = new Set<string>();
        for (const [file, stat] of files) {
          if (claimed.has(file) || !outputName.test(path.basename(file))) continue;
          const data = await this.record(file), group = [file, `${file}.json`, `${file}.lifecycle.json`].filter(item => files.has(item));
          group.forEach(item => claimed.add(item));
          entries.push({ file, files: group, bytes: group.reduce((sum, item) => sum + files.get(item)!.size, 0),
            access: data?.lastAccessAt ?? stat.mtimeMs, sources: data?.bytes === stat.size ? data.sources : undefined,
            transient: data?.transient === true, disposable: true });
        }
        for (const [candidate] of files) {
          const file = candidate.endsWith('.work.json') ? candidate.slice(0, -'.work.json'.length) : candidate;
          if (claimed.has(candidate) || claimed.has(file) || !partName.test(path.basename(file))) continue;
          let startedAt: number | undefined;
          try {
            const marker = JSON.parse(await fs.readFile(`${file}.work.json`, 'utf8'));
            if (files.has(`${file}.work.json`) && marker.schema === 1 && Number.isFinite(marker.startedAt)) startedAt = marker.startedAt;
          } catch { /* An unmarked partial still expires after the abandoned-work interval. */ }
          const group = [file, `${file}.scaled.wav`, `${file}.wv`, `${file}.json`, `${file}.work.json`].filter(item => files.has(item));
          group.forEach(item => claimed.add(item));
          entries.push({ file, files: group, bytes: group.reduce((sum, item) => sum + files.get(item)!.size, 0),
            access: Math.max(startedAt ?? 0, ...group.map(item => files.get(item)!.mtimeMs)), partial: true });
        }
        for (const [file, stat] of files) if (!claimed.has(file)) {
          const sidecar = path.basename(file).match(sidecarName);
          entries.push({ file, files: [file], bytes: stat.size, access: stat.mtimeMs,
            disposable: !!sidecar, owner: sidecar ? path.join(directory, sidecar[1]) : undefined });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push('部分缓存目录无法安全读取，已保留');
      }
    }
    return { entries, microphoneBytes: totals[0], mixBytes: totals[1], warnings: [...new Set(warnings)] };
  }
  private removable(entry: Entry): boolean {
    if (entry.partial) return this.now() - entry.access >= this.policy.abandonedMs;
    return entry.disposable === true;
  }
  private async orphaned(entry: Entry): Promise<boolean> {
    if (!entry.disposable) return false;
    if (!entry.sources?.length) return true;
    for (const source of entry.sources) {
      try { if (!(await fs.lstat(source.path)).isFile()) return true; }
      catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return true; }
    }
    return false;
  }
  private using(entry: Entry): boolean {
    if (this.pins.has(comparable(entry.owner ?? entry.file))) return true;
    // An active final output also owns its temporary siblings.
    return partName.test(path.basename(entry.file)) && ['wav', 'wv'].some(extension => this.pins.has(comparable(
      path.join(path.dirname(entry.file), `${path.basename(entry.file).slice(0, 64)}.${extension}`))));
  }
  private async snapshotFrom(scan: Scan): Promise<AudioCacheSnapshot> {
    let clearableBytes = 0, protectedBytes = 0, inUseBytes = 0;
    for (const entry of scan.entries) {
      if (this.using(entry)) inUseBytes += entry.bytes;
      else if (this.removable(entry)) clearableBytes += entry.bytes;
      else protectedBytes += entry.bytes;
    }
    return { totalBytes: scan.microphoneBytes + scan.mixBytes, microphoneBytes: scan.microphoneBytes, mixBytes: scan.mixBytes,
      clearableBytes, protectedBytes, inUseBytes, budgetBytes: this.policy.maxBytes,
      idleDays: this.policy.maxIdleMs / (24 * 60 * 60 * 1000), warnings: [...new Set([...scan.warnings, ...this.cleanupWarnings])] };
  }
  state(): Promise<AudioCacheSnapshot> { return this.serial(async () => this.snapshotFrom(await this.scan())); }
  maintain(): Promise<Removal> { return this.clean(false); }
  async clear(): Promise<AudioCacheCleanup> {
    const removed = await this.clean(true);
    return { ...removed, snapshot: await this.state() };
  }
  /** Remove a disposable trial's own results without touching its original. */
  async clearForSource(source: string): Promise<Removal> {
    const canonical = await fs.realpath(source).catch(() => path.resolve(source));
    return this.clean(true, canonical);
  }
  private clean(manual: boolean, source?: string): Promise<Removal> {
    return this.serial(async () => {
      const scan = await this.scan();
      let total = scan.microphoneBytes + scan.mixBytes, freedBytes = 0, removedFiles = 0;
      const pressure = total > this.policy.maxBytes;
      this.nextMaintenanceDelay = 6 * 60 * 60 * 1000;
      for (const entry of scan.entries.sort((a, b) => a.access - b.access)) {
        if (!source && !this.maintenanceAllowed()) break;
        if (source && (!entry.sources?.length || !entry.sources.every(item => item.path === source))) continue;
        const age = this.now() - entry.access;
        const orphaned = await this.orphaned(entry);
        if ((entry.transient || orphaned) && !this.using(entry) && age < this.policy.recentMs) {
          this.nextMaintenanceDelay = Math.min(this.nextMaintenanceDelay, Math.max(1000, this.policy.recentMs - age));
        }
        if (this.using(entry) || (!manual && !entry.partial && age < this.policy.maxIdleMs
          && !((entry.transient || orphaned) && age >= this.policy.recentMs)
          && (!pressure || total <= this.policy.targetBytes || age < this.policy.recentMs))) continue;
        if (!this.removable(entry) || this.using(entry) || (!source && !this.maintenanceAllowed())) continue;
        // Later resolvers pin immediately, then await ready() before validation or publication.
        for (const file of entry.files) {
          try {
            const stat = await fs.lstat(file);
            if (!stat.isFile()) continue;
            await fs.unlink(file); freedBytes += stat.size; total -= stat.size; removedFiles++;
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') scan.warnings.push('部分缓存清理失败，稍后可重试'); }
        }
      }
      this.cleanupWarnings = [...new Set(scan.warnings)];
      return { freedBytes, removedFiles };
    });
  }
}
