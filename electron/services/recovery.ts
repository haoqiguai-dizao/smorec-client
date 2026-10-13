import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { CanvasStyle, CursorSample, Project } from '../../shared/types';
import { DEFAULT_STYLE } from '../../shared/constants';
import { APP_NAME } from '../../shared/brand';
import { generateAutoZooms } from '../../shared/timeline';
import { ffmpegPath, probeMedia } from './ffmpeg';
import { object, parseProject } from './validation';
import { diagnostic } from './diagnostics';
import { recoveryPresentationDuration } from './recovery-duration';
import { recoverInputActivity } from './input-activity-recovery';

interface RecoveredProject { project: Project; warnings: string[] }
const exists = (file: string) => fs.stat(file).then((stat) => stat.isFile()).catch(() => false);
async function assertLocal(directory: string, file: string): Promise<void> {
  if (!await exists(file)) return;
  const relative = path.relative(await fs.realpath(directory), await fs.realpath(file));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('恢复媒体必须位于工程目录内');
}
async function readSmallJson(file: string): Promise<Record<string, unknown>> {
  if ((await fs.stat(file)).size > 128 * 1024 * 1024) throw new Error('恢复文件过大');
  return object(JSON.parse(await fs.readFile(file, 'utf8')));
}
function localFile(directory: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || path.basename(value) !== value || /[\\/:\0]/.test(value)) return undefined;
  return path.join(directory, value);
}
async function recoverAudio(source: string, output: string, origin: number, duration: number): Promise<boolean> {
  const stat = await fs.stat(source).catch(() => undefined);
  if (!stat?.isFile() || stat.size <= 44) return false;
  return new Promise<boolean>((resolve) => {
    const process = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
      '-af', `atrim=start=${origin.toFixed(6)}:end=${(origin + duration).toFixed(6)},asetpts=PTS-STARTPTS,apad,atrim=duration=${duration.toFixed(6)}`,
      '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', output], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let message = '';
    const timer = setTimeout(() => process.kill(), 120_000);
    process.stderr.on('data', (data: Buffer) => { message = (message + data.toString()).slice(-3000); });
    process.once('error', (error) => { clearTimeout(timer); diagnostic('recovery.audio', error); resolve(false); });
    process.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) diagnostic('recovery.audio', message);
      resolve(code === 0);
    });
  });
}
async function recoverCursor(directory: string, origin: number, duration: number): Promise<CursorSample[]> {
  const final = path.join(directory, 'cursor.json');
  if (await exists(final)) {
    if ((await fs.stat(final)).size > 128 * 1024 * 1024) throw new Error('光标文件过大');
    const value: unknown = JSON.parse(await fs.readFile(final, 'utf8'));
    if (Array.isArray(value)) return value as CursorSample[];
  }
  const journal = path.join(directory, 'cursor.recovery.jsonl');
  if (!await exists(journal)) return [];
  if ((await fs.stat(journal)).size > 128 * 1024 * 1024) throw new Error('光标日志过大');
  const samples: CursorSample[] = [];
  let lastTime = 0;
  for (const line of (await fs.readFile(journal, 'utf8')).split(/\r?\n/)) {
    try {
      const sample = object(JSON.parse(line));
      if (typeof sample.t !== 'number' || !Number.isFinite(sample.t) || sample.t < origin || sample.t > origin + duration) continue;
      if (typeof sample.x !== 'number' || !Number.isFinite(sample.x) || typeof sample.y !== 'number' || !Number.isFinite(sample.y)) continue;
      lastTime = Math.max(lastTime, sample.t - origin);
      samples.push({ t: lastTime, x: sample.x, y: sample.y, visible: sample.visible === true, click: sample.click === true,
        shape: sample.shape === 'hand' || sample.shape === 'ibeam' ? sample.shape : 'arrow',
        ...(typeof sample.primaryDown === 'boolean' ? { primaryDown: sample.primaryDown } : {}) });
    } catch { /* A process crash may leave the final journal line incomplete. */ }
  }
  return samples;
}
export async function recoverProject(directory: string, id: string,
  canvasDefaults: () => CanvasStyle = () => ({ ...DEFAULT_STYLE })): Promise<RecoveredProject | undefined> {
  if (await exists(path.join(directory, 'project.json')) || !await exists(path.join(directory, 'screen.mp4'))) return undefined;
  const recoveryFile = path.join(directory, 'recording.recovery.json');
  const finalFile = path.join(directory, 'recording.json');
  const finalized = await exists(finalFile);
  if (!await exists(recoveryFile) && !finalized) return undefined;
  for (const filename of ['screen.mp4', 'recording.recovery.json', 'recording.json', 'cursor.json', 'cursor.recovery.jsonl',
    'system.recovery.wav', 'microphone.recovery.wav', 'system.wav', 'microphone.wav']) await assertLocal(directory, path.join(directory, filename));
  const metadata = await readSmallJson(finalized ? finalFile : recoveryFile);
  const info = await probeMedia(path.join(directory, 'screen.mp4'));
  const duration = recoveryPresentationDuration(info.duration, metadata, finalized);
  const origin = typeof metadata.clockOrigin === 'number' && Number.isFinite(metadata.clockOrigin) ? Math.max(0, metadata.clockOrigin) : 0;
  if (origin > 120) throw new Error('恢复时钟超出允许范围');
  const options = metadata.options && typeof metadata.options === 'object' ? object(metadata.options) : {};
  const cursor = await recoverCursor(directory, origin, duration);
  const activity = await recoverInputActivity(directory, origin, duration);
  const media: Project['media'] = { screen: 'screen.mp4' };
  const warnings: string[] = activity.warning ? [activity.warning] : [];
  const generated = randomUUID();
  for (const [key, name] of [['systemAudio', 'system'], ['microphone', 'microphone']] as const) {
    const finalized = localFile(directory, metadata[key]) ?? path.join(directory, `${name}.wav`);
    await assertLocal(directory, finalized);
    if (await exists(finalized) && (await fs.stat(finalized)).size > 44) { media[key] = path.basename(finalized); continue; }
    const source = path.join(directory, `${name}.recovery.wav`);
    const filename = `${name}.recovered-${generated}.wav`;
    const output = path.join(directory, filename);
    if (await recoverAudio(source, output, origin, duration)) media[key] = filename;
    else {
      await fs.rm(output, { force: true }).catch(() => {});
      if (options[key] === true || await exists(source)) warnings.push(`${name === 'system' ? '系统声音' : '麦克风'}没有可恢复的音频`);
    }
  }
  const date = typeof metadata.createdAt === 'string' && Number.isFinite(Date.parse(metadata.createdAt)) ? metadata.createdAt : (await fs.stat(path.join(directory, 'screen.mp4'))).mtime.toISOString();
  const project = parseProject({ id, name: `${APP_NAME}录制（已恢复） ${new Date(date).toLocaleString('zh-CN', { hour12: false })}`,
    createdAt: date, duration, width: info.width, height: info.height, fps: options.fps === 60 ? 60 : 30,
    media, cursor, ...(activity.inputActivity === undefined ? {} : { inputActivity: activity.inputActivity }),
    clips: [{ id: randomUUID(), start: 0, end: duration }],
    zooms: generateAutoZooms(cursor, duration, activity.inputActivity), style: canvasDefaults(), audio: { system: 1, microphone: 1 } });
  diagnostic('recovery.ready', undefined, { id, duration, videoDuration: info.duration, cursorSamples: cursor.length, warnings });
  return { project, warnings };
}
