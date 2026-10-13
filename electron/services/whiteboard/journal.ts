import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BoardEvent, BoardRecording } from '../../../shared/whiteboard/types';
import { parseBoardRecording } from '../../../shared/whiteboard/validation';
import type { BoardImage, BoardPoint } from '../../../shared/whiteboard/types';
import { imageFile, storeImage } from './images';
import { imageAssets } from './images';
import { attachRecordedBoardVideo } from './recorded-video';
import { draftContent } from './draft';

const filename = 'whiteboard.jsonl';
/** Ordered append-only recovery log. No renderer can choose its path or timestamps. */
export class WhiteboardJournal {
  session = '';
  events: BoardEvent[] = [];
  private directory?: string;
  private startedAt?: number;
  private pending = Promise.resolve();
  private failure?: Error;
  private points = 0;
  private separateCanvas = false;
  private outputCommitted = false;
  private preview = false;
  private seed?: { directory: string; events: BoardEvent[] };
  private transition = Promise.resolve();
  private changing(operation: () => Promise<void>): Promise<void> {
    const result = this.transition.then(operation);
    this.transition = result.catch(() => {});
    return result;
  }
  reset(directory: string, separateCanvas = false): Promise<void> {
    return this.changing(async () => {
      await this.pending;
      this.seed = this.preview && this.directory ? { directory: this.directory, events: draftContent(this.events) } : undefined;
      this.session = randomUUID(); this.directory = directory; this.startedAt = undefined;
      this.events = this.seed?.events ?? []; this.failure = undefined;
      this.points = this.events.reduce((total, event) => total + (event.action.kind === 'stroke' ? event.action.points.length : 0), 0);
      this.separateCanvas = separateCanvas; this.outputCommitted = false; this.preview = false;
    });
  }
  startPreview(directory: string, fresh = false): Promise<void> {
    return this.changing(async () => {
      await this.pending;
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const saved = fresh ? undefined : await readRecordedBoard(directory, 24 * 3600);
      this.events = (saved?.events ?? []).map(event => ({ ...event, t: 0 }));
      // Repair only a possible unfinished final append before continuing the owned draft.
      await fs.writeFile(path.join(directory, filename), this.events.map(event => JSON.stringify({ ...event, t: 0 }) + '\n').join(''), { mode: 0o600 });
      this.session = randomUUID(); this.directory = directory; this.startedAt = 0;
      this.failure = undefined; this.separateCanvas = false; this.outputCommitted = false; this.preview = true; this.seed = undefined;
      this.points = this.events.reduce((total, event) => total + (event.action.kind === 'stroke' || event.action.kind === 'erase' ? event.action.points.length : 0), 0);
    });
  }
  async newBoard(): Promise<void> {
    // Keep the earlier recording replayable, but invalidate its editing/undo session.
    await this.append({ kind: 'reset' });
    this.session = randomUUID();
  }
  seedLayout(action: Extract<BoardEvent['action'], { kind: 'layout' }>): void {
    if (this.seed && this.startedAt === undefined) this.events.push({ t: 0, action: structuredClone(action) });
  }
  start(timestamp: number): void {
    this.startedAt = timestamp;
    const seed = this.seed, directory = this.directory;
    if (!seed || !directory) return;
    const events = structuredClone(this.events);
    const writing = this.pending.then(async () => {
      const assets = imageAssets({ events });
      if (assets.length) await fs.mkdir(path.join(directory, 'whiteboard-assets'), { recursive: true });
      for (const asset of assets) await fs.copyFile(await imageFile(seed.directory, asset), path.join(directory, 'whiteboard-assets', `${asset}.png`), fs.constants.COPYFILE_EXCL);
      if (this.separateCanvas) { await fs.writeFile(path.join(directory, 'whiteboard-output.json'), '{"separateCanvas":true}', { mode: 0o600 }); this.outputCommitted = true; }
      if (events.length) await fs.writeFile(path.join(directory, filename), events.map(event => JSON.stringify(event) + '\n').join(''), { flag: 'wx', mode: 0o600 });
      this.seed = undefined;
    });
    this.pending = writing.catch(error => { this.failure = error instanceof Error ? error : new Error(String(error)); });
  }
  async importImage(bytes: Uint8Array, point: BoardPoint): Promise<BoardImage> {
    if (!this.directory || this.startedAt === undefined) throw new Error('请在录制开始后使用白板');
    const session = this.session, directory = this.directory;
    if (imageAssets({ events: this.events }).length >= 40) throw new Error('一次录制最多添加 40 张图片');
    const image = await storeImage(directory, bytes, point);
    try {
      if (session !== this.session) throw new Error('白板会话已失效');
      await this.append(image);
    }
    catch (error) { await fs.rm(path.join(directory, 'whiteboard-assets', `${image.asset}.png`), { force: true }); throw error; }
    return image;
  }
  async assetFile(session: string, asset: string): Promise<string> {
    if (session !== this.session || !this.directory) throw new Error('白板会话已失效');
    if (!this.events.some(event => event.action.kind === 'image' && event.action.asset === asset))
      throw new Error('白板图片不存在');
    return imageFile(this.seed?.directory ?? this.directory, asset);
  }
  append(action: BoardEvent['action'], now = Date.now()): Promise<void> {
    if (!this.directory || this.startedAt === undefined) throw new Error('请在录制开始后使用白板');
    if (this.failure) throw this.failure;
    const points = action.kind === 'stroke' || action.kind === 'erase' ? action.points.length : 0;
    if (this.events.length >= 100_000 || this.points + points > 1_000_000) throw new Error('本次白板已达容量，请结束录制后新建');
    const event = { t: this.preview ? 0 : Math.max(this.events.at(-1)?.t ?? 0, (now - this.startedAt) / 1000), action: structuredClone(action) };
    this.events.push(event); this.points += points;
    const file = path.join(this.directory, filename);
    const output = this.separateCanvas && !this.outputCommitted;
    this.outputCommitted ||= output;
    const writing = this.pending.then(async () => {
      if (this.failure) throw this.failure;
      // Commit before the first board event, after native start has accepted the empty directory.
      if (output) await fs.writeFile(path.join(this.directory!, 'whiteboard-output.json'), '{"separateCanvas":true}', { mode: 0o600 });
      return fs.appendFile(file, JSON.stringify(event) + '\n', { encoding: 'utf8', mode: 0o600 });
    });
    this.pending = writing.catch(error => { this.failure = error instanceof Error ? error : new Error(String(error)); });
    return writing;
  }
  async flush(): Promise<void> { await this.pending; if (this.failure) throw this.failure; }
}

export async function readRecordedBoard(directory: string, duration: number): Promise<BoardRecording | undefined> {
  const file = path.join(directory, filename);
  const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (!stat) return undefined;
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new Error('白板记录文件无效或过大');
  const data = await fs.readFile(file, 'utf8');
  // A crash can leave only the final append incomplete; preserve every completed line.
  const lines = data.slice(0, data.lastIndexOf('\n') + 1).split('\n').filter(Boolean);
  const recording = parseBoardRecording({ events: lines.map(line => JSON.parse(line)) }, 24 * 3600);
  const outputFile = path.join(directory, 'whiteboard-output.json');
  const outputStat = await fs.lstat(outputFile).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (outputStat) {
    if (!outputStat.isFile() || outputStat.size > 1024) throw new Error('白板画布来源记录无效');
    const output = parseBoardRecording({ ...JSON.parse(await fs.readFile(outputFile, 'utf8')), events: [] }, 0);
    recording.separateCanvas = output.separateCanvas;
  }
  recording.events = recording.events.filter(event => event.t <= duration + .1).map(event => ({ ...event, t: Math.min(duration, event.t) }));
  await attachRecordedBoardVideo(directory, recording, duration);
  return recording;
}
