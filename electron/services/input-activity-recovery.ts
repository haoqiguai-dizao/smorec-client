import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { InputActivity } from '../../shared/types';
import { parseInputActivity } from './input-activity';

const MAX_BYTES = 128 * 1024 * 1024;
export const INPUT_ACTIVITY_FILES = ['input-activity.json', 'input-activity.recovery.jsonl'] as const;

async function localActivityFile(directory: string, name: string): Promise<string | undefined> {
  const file = path.join(directory, name);
  const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  });
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_BYTES) throw new Error('输入活动文件无效');
  const relative = path.relative(await fs.realpath(directory), await fs.realpath(file));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('输入活动文件不在工程目录内');
  return file;
}

export async function recoverInputActivity(directory: string, origin: number, duration: number): Promise<{
  inputActivity?: InputActivity[]; warning?: string;
}> {
  try {
    const final = await localActivityFile(directory, INPUT_ACTIVITY_FILES[0]);
    if (final) return { inputActivity: parseInputActivity(JSON.parse(await fs.readFile(final, 'utf8')), duration) };
    const journal = await localActivityFile(directory, INPUT_ACTIVITY_FILES[1]);
    if (!journal) return {};
    const lines = (await fs.readFile(journal, 'utf8')).split(/\r?\n/).filter(line => line.trim());
    // An unknown/missing reset can misattribute all later typing; discard the optional
    // track on any damaged line instead of attempting to bridge through it.
    const events = parseInputActivity(lines.map(line => JSON.parse(line)), 24 * 3600 + 120);
    return { inputActivity: events.filter(event => event.t >= origin && event.t <= origin + duration)
      .map(event => ({ ...event, t: event.t - origin })) };
  } catch {
    return { warning: '输入活动记录不完整，已使用仅点击镜头，原始录像已保留。' };
  }
}
