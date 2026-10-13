import { dialog, type BrowserWindow } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ExportSession, ExportSettings } from '../../shared/types';
import { ffmpegPath } from './ffmpeg';
import { ProjectStore, type StoredProject } from './projects';
import { exportSettings, string } from './validation';
import { userPreferences } from './user-preferences';
import { exportAudioFilters } from './export-audio';
import { resolveProjectAudio } from './project-audio';
import { exportVideoPayload, exportVideoTransport } from './export-codec';
import { audioCacheManager } from './audio-cache';
import type { AudioCacheLease } from './audio-cache-manager';

interface Session {
  id: string; destination: string; temporary: string; process: ChildProcessWithoutNullStreams;
  settings: ExportSettings; received: number; closed: Promise<number | null>; stderr: string;
  failure?: Error; canceled: boolean; finishing: boolean; writing: boolean;
}
async function audioArgs(stored: StoredProject, length: number, signal: AbortSignal, lease: AudioCacheLease): Promise<string[]> {
  const input = await resolveProjectAudio(stored, stored.project.audio, signal, lease);
  if (!input) return ['-map', '0:v:0', '-an'];
  const filters = exportAudioFilters([input.volume], stored.project.clips, length, input.channels);
  return ['-i', input.path, '-filter_complex', filters, '-map', '0:v:0', '-map', '[outa]', '-c:a', 'aac', '-b:a', '192k'];
}
export class Exporter {
  private session?: Session;
  private starting = false;
  private preparation?: AbortController;
  private completed = new Set<string>();
  constructor(private projects: ProjectStore) {}
  isActive(): boolean { return Boolean(this.session || this.starting); }
  async start(window: BrowserWindow, value: unknown, configuration: unknown): Promise<ExportSession | null> {
    if (this.session || this.starting) throw new Error('已有视频正在导出');
    this.starting = true;
    const preparation = new AbortController(); this.preparation = preparation;
    let audioLease: AudioCacheLease | undefined;
    try {
    const stored = this.projects.edited(value);
    const settings = exportSettings(configuration);
    const duration = stored.project.clips.reduce((total, clip) => total + clip.end - clip.start, 0);
    if (Math.abs(settings.frames - Math.ceil(duration * settings.fps)) > 1) throw new Error('导出帧数与工程时长不匹配');
    const choice = await dialog.showSaveDialog(window, { title: '导出 MP4',
      defaultPath: path.join(userPreferences.existingDirectory('exportDirectory') ?? '', `${stored.project.name.replace(/[<>:"/\\|?*]/g, '_')}.mp4`),
      filters: [{ name: settings.codec === 'hevc' ? 'MP4 视频（HEVC）' : 'MP4 视频', extensions: ['mp4'] }] });
    if (choice.canceled || !choice.filePath) return null;
    preparation.signal.throwIfAborted();
    if (this.session) throw new Error('已有视频正在导出');
    const destination = choice.filePath;
    userPreferences.update({ exportDirectory: path.dirname(destination) });
    const id = randomUUID();
    const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${id}.part.mp4`);
    audioLease = audioCacheManager().lease();
    const audio = await audioArgs(stored, settings.frames / settings.fps, preparation.signal, audioLease);
    preparation.signal.throwIfAborted();
    const transport = exportVideoTransport(settings);
    const child = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'warning', '-y', ...transport.input, '-i', 'pipe:0',
      ...audio, ...transport.output,
      '-r', String(settings.fps), '-t', String(settings.frames / settings.fps), '-movflags', '+faststart', temporary],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const closed = new Promise<number | null>((resolve) => child.once('close', resolve));
    const activeLease = audioLease; audioLease = undefined;
    child.once('close', () => activeLease.release());
    const session: Session = { id, destination, temporary, process: child, settings, received: 0, closed,
      stderr: '', canceled: false, finishing: false, writing: false };
    this.session = session;
    child.on('error', (error) => { session.failure = error; });
    child.stdin.on('error', (error) => { session.failure = error; });
    child.stderr.on('data', (chunk: Buffer) => { session.stderr = (session.stderr + chunk.toString()).slice(-8000); });
    child.stdout.resume();
    try { if (transport.header) await this.write(session, transport.header); }
    catch (error) { await this.cancel(id); throw error; }
    return { id, path: destination };
    } finally { audioLease?.release(); this.starting = false; if (this.preparation === preparation) this.preparation = undefined; }
  }
  private get(value: unknown): Session {
    const id = string(value, 36);
    if (!this.session || this.session.id !== id) throw new Error('导出会话已结束');
    return this.session;
  }
  private write(session: Session, buffer: Buffer): Promise<void> {
    if (session.failure) return Promise.reject(session.failure);
    if (session.process.exitCode !== null || session.canceled) return Promise.reject(new Error(session.stderr || '导出进程已结束'));
    return new Promise((resolve, reject) => {
      session.process.stdin.write(buffer, (error) => error ? reject(error) : resolve());
    });
  }
  async append(id: unknown, data: unknown): Promise<void> {
    const session = this.get(id);
    if (session.finishing || session.writing) throw new Error('请按顺序写入视频帧');
    if (!(data instanceof ArrayBuffer) || data.byteLength < 13 || data.byteLength > 64 * 1024 * 1024) throw new Error('视频帧数据无效');
    const frame = Buffer.from(data);
    if (frame.readUInt32LE(0) !== frame.length - 12 || frame.readBigUInt64LE(4) !== BigInt(session.received)) throw new Error('视频帧格式或顺序无效');
    if (session.received >= session.settings.frames) throw new Error('视频帧数超过预期');
    session.writing = true;
    try {
      const payload = exportVideoPayload(session.settings, frame);
      await this.write(session, payload); session.received++;
    }
    finally { session.writing = false; }
  }
  async finish(id: unknown): Promise<string> {
    const session = this.get(id);
    if (session.finishing || session.writing) throw new Error('导出还在写入或正在完成');
    if (session.received !== session.settings.frames) throw new Error('视频帧数不完整');
    session.finishing = true;
    session.process.stdin.end();
    try {
      const code = await session.closed;
      if (session.canceled) throw new Error('导出已取消');
      if (session.failure || code !== 0) throw new Error(session.stderr || session.failure?.message || '视频编码失败');
      await fs.rename(session.temporary, session.destination);
      this.completed.add(session.destination);
      return session.destination;
    } finally {
      await fs.rm(session.temporary, { force: true }).catch(() => {});
      if (this.session === session) this.session = undefined;
    }
  }
  async cancel(id: unknown): Promise<void> {
    const session = this.get(id);
    session.canceled = true;
    session.process.stdin.destroy();
    session.process.kill();
    const deadline = setTimeout(() => session.process.kill('SIGKILL'), 2000);
    try { await session.closed; } finally { clearTimeout(deadline); }
    await fs.rm(session.temporary, { force: true }).catch(() => {});
    if (this.session === session) this.session = undefined;
  }
  isCompleted(file: unknown): file is string { return typeof file === 'string' && this.completed.has(file); }
  cancelPreparation(): void { if (!this.session) this.preparation?.abort(); }
  async dispose(): Promise<void> { this.preparation?.abort(); if (this.session) await this.cancel(this.session.id); }
}
