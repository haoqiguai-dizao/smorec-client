import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DemoRange } from '../../../shared/demo';

interface Keyframe { t: number; visible: boolean; camera?: 'independent' }
const filename = 'demo-capture.json';
/** Persist before reporting a switch as successful, including interrupted-recording recovery. */
export class DemoJournal {
  private frames: Keyframe[] = [];
  private directory?: string;
  private writing?: Promise<void>;
  async start(directory: string, visible: boolean, camera?: 'independent'): Promise<void> {
    this.directory = directory; this.frames = [{ t: 0, visible, ...(camera ? { camera } : {}) }]; await this.persist();
  }
  async set(t: number, visible: boolean, camera?: 'independent'): Promise<void> {
    if (!this.directory || !Number.isFinite(t) || t < 0) throw new Error('演示录制时钟无效');
    this.frames.push({ t: Math.max(t, this.frames.at(-1)?.t ?? 0), visible, ...(camera ? { camera } : {}) });
    await this.persist();
  }
  flush(): Promise<void> { return this.writing ?? Promise.resolve(); }
  private persist(): Promise<void> {
    const file = path.join(this.directory!, filename), temporary = file + '.tmp';
    this.writing = fs.writeFile(temporary, JSON.stringify(this.frames)).then(() => fs.rename(temporary, file));
    return this.writing;
  }
}
export async function readDemoRanges(directory: string, duration: number): Promise<DemoRange[] | undefined> {
  let frames: unknown;
  try {
    const file = path.join(directory, filename);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('演示录制记录无效');
    frames = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (!Array.isArray(frames) || frames.length > 20000) throw new Error('演示录制记录无效');
  const ranges: DemoRange[] = [];
  let last = 0;
  frames.forEach((frame, index) => {
    if (!frame || typeof frame.t !== 'number' || !Number.isFinite(frame.t) || frame.t < last
      || typeof frame.visible !== 'boolean' || frame.camera !== undefined && frame.camera !== 'independent') throw new Error('演示录制记录无效');
    last = frame.t;
    const end = Math.min(duration, frames[index + 1]?.t ?? duration);
    if (frame.visible && frame.t < end) ranges.push({ start: frame.t, end, ...(frame.camera ? { camera: frame.camera } : {}) });
  });
  return ranges.length ? ranges : undefined;
}
