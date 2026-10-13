import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const pending = new Map<string, Promise<void>>();

/** Preserve the recoverable fragment stream; build a seekable MP4 index without re-encoding. */
export function prepareRecordedBoardVideo(directory: string): Promise<void> {
  const key = path.resolve(directory), current = pending.get(key);
  if (current) return current;
  const task = prepare(key).finally(() => pending.delete(key)); pending.set(key, task); return task;
}

async function prepare(directory: string): Promise<void> {
  const source = path.join(directory, 'whiteboard-capture.mp4'), output = path.join(directory, 'whiteboard.mp4');
  const captured = await fs.lstat(source).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  // Released Mac/legacy recordings already use the canonical file directly.
  if (!captured) return;
  if (!captured.isFile() || captured.size < 32) throw new Error('完整白板原始视频无效');
  const completed = await fs.lstat(output).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
  if (completed) {
    if (!completed.isFile() || completed.size < 32) throw new Error('完整白板视频无效');
    return;
  }
  const temporary = path.join(directory, `whiteboard-${randomUUID()}.tmp.mp4`);
  try {
    const { ffmpegPath } = await import('../ffmpeg');
    await new Promise<void>((resolve, reject) => {
      const child = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-n', '-i', source,
        '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', '-f', 'mp4', temporary], { windowsHide: true });
      let diagnostic = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('完整白板视频整理超时，原始素材已保留')); }, 30000);
      child.stdout.resume(); child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes.toString()).slice(-2000); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve(); else reject(new Error('完整白板视频整理失败，原始素材已保留：' + diagnostic));
      });
    });
    await fs.rename(temporary, output);
  } finally { await fs.rm(temporary, { force: true }); }
}
