import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ffmpegPath, probeMedia } from './ffmpeg';
import { diagnostic } from './diagnostics';
import { number, string } from './validation';
import { CameraDataHealth, cameraCoverageWarning, cameraFramesStalled } from './camera-health';
import { cameraContainer, cameraHeaderLength, validateCameraChunkHeader, type CameraContainer } from '../../shared/camera-container';

type Command = { id: string; action: 'start' | 'stop' | 'cancel' };
interface Signal { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }
function signal(): Signal {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
interface CameraSession {
  id: string; directory: string; raw: string; handle?: FileHandle; bytes: number; writing: boolean;
  state: 'prepared' | 'starting' | 'recording' | 'stopping' | 'finished' | 'canceled';
  startedAtUnixMs?: number; startRequestedAt?: number; started: Signal; finished: Signal;
  health?: CameraDataHealth; healthTimer?: ReturnType<typeof setInterval>; framesStalled?: boolean;
  recoveryDirectory?: string; preserveOnCleanup?: boolean; preserving?: Promise<boolean>;
  format?: CameraContainer;
}
export interface CameraAttachment { filename: string; offset: number; warnings?: string[] }
export class CameraManager {
  private session?: CameraSession;
  onCommand?: (command: Command) => void;
  onWarning?: (id: string, warning: string) => void;
  onRecovered?: (id: string) => void;
  private preparing = false;
  hasPermission(): boolean { return Boolean(this.session && !['finished', 'canceled'].includes(this.session.state)); }
  isPrepared(id: unknown): boolean { return typeof id === 'string' && this.session?.id === id && this.session.state === 'prepared'; }
  async prepare(): Promise<{ id: string }> {
    if (this.session || this.preparing) throw new Error('摄像头会话已经存在，请先关闭当前预览');
    this.preparing = true;
    try {
      const id = randomUUID();
      const directory = path.join(app.getPath('userData'), 'camera-staging', id);
      await fs.mkdir(directory, { recursive: true });
      const raw = path.join(directory, 'camera.part');
      const handle = await fs.open(raw, 'wx');
      this.session = { id, directory, raw, handle, bytes: 0, writing: false, state: 'prepared', started: signal(), finished: signal() };
      diagnostic('camera.prepare', undefined, { id });
      return { id };
    } finally { this.preparing = false; }
  }
  private get(value: unknown): CameraSession {
    const id = string(value, 36);
    if (!this.session || this.session.id !== id || this.session.state === 'canceled') throw new Error('摄像头会话已结束');
    return this.session;
  }
  private async wait(promise: Promise<void>, message: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 15_000); })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async start(id: string, directory?: string): Promise<void> {
    const session = this.get(id);
    if (session.state !== 'prepared') throw new Error('摄像头会话无法重复开始');
    session.recoveryDirectory = directory; session.preserveOnCleanup = Boolean(directory);
    session.state = 'starting'; session.startRequestedAt = Date.now();
    this.onCommand?.({ id, action: 'start' });
    await this.wait(session.started.promise, '摄像头未能在 15 秒内开始录制');
  }
  started(id: unknown, value: unknown, mimeType?: unknown): void {
    const session = this.get(id);
    if (session.state !== 'starting') throw new Error('摄像头开始事件顺序无效');
    const timestamp = number(value, (session.startRequestedAt ?? Date.now()) - 2000, Date.now() + 2000);
    session.format = cameraContainer(mimeType);
    session.startedAtUnixMs = timestamp; session.state = 'recording'; session.started.resolve();
    session.health = new CameraDataHealth(performance.now());
    session.healthTimer = setInterval(() => {
      if (session.state !== 'recording') return;
      const warning = session.health?.warning(performance.now());
      if (warning) {
        diagnostic('camera.data-stalled', undefined, { id: session.id, bytes: session.bytes });
        this.onWarning?.(session.id, warning);
      }
    }, 1000);
    session.healthTimer.unref();
    diagnostic('camera.started', undefined, { id: session.id, startedAtUnixMs: timestamp, mimeType: session.format.mimeType });
  }
  async append(id: unknown, data: unknown): Promise<void> {
    const session = this.get(id);
    if (!['starting', 'recording', 'stopping'].includes(session.state) || session.writing || !session.handle) throw new Error('摄像头数据必须按顺序写入');
    if (!(data instanceof ArrayBuffer) || data.byteLength < 1 || data.byteLength > 64 * 1024 * 1024) throw new Error('摄像头分块大小无效（上限 64MB）');
    if (session.bytes + data.byteLength > 16 * 1024 ** 3) throw new Error('摄像头录制已达到 16GB 上限，请停止录制');
    const buffer = Buffer.from(data);
    if (!session.format) throw new Error('摄像头编码格式尚未确认');
    validateCameraChunkHeader(session.format, session.bytes, buffer);
    session.writing = true;
    try {
      let written = 0;
      while (written < buffer.length) {
        const result = await session.handle.write(buffer, written, buffer.length - written);
        if (!result.bytesWritten) throw new Error('摄像头文件写入失败');
        written += result.bytesWritten;
      }
      session.bytes += buffer.length;
      if (session.health?.append(performance.now())) {
        diagnostic('camera.data-resumed', undefined, { id: session.id, bytes: session.bytes });
        this.onRecovered?.(session.id);
      }
    } catch (error) { diagnostic('camera.write', error, { id: session.id, bytes: session.bytes }); throw error; }
    finally { session.writing = false; }
  }
  async finish(id: unknown): Promise<void> {
    const session = this.get(id);
    try {
      if (!['recording', 'stopping'].includes(session.state) || session.writing || !session.handle) throw new Error('摄像头还有分块未写入');
      if (!session.format || session.bytes < cameraHeaderLength(session.format)) throw new Error('摄像头没有录到视频数据');
      await session.handle.sync(); await session.handle.close(); session.handle = undefined;
      clearInterval(session.healthTimer);
      session.state = 'finished'; session.finished.resolve();
      diagnostic('camera.finished', undefined, { id: session.id, bytes: session.bytes });
    } catch (error) { session.finished.reject(error instanceof Error ? error : new Error(String(error))); throw error; }
  }

  /**
   * Frame liveness is reported by the recorder's own frame clock, which requires a matching live
   * session. A late report after stop is ignored rather than logged as an invalid IPC request.
   */
  private reportingSession(value: unknown): CameraSession | undefined {
    const session = this.session;
    if (!session || session.state !== 'recording') return undefined;
    try { return string(value, 36) === session.id ? session : undefined; }
    catch { return undefined; }
  }

  reportFrameStall(id: unknown, stalledSeconds: unknown): void {
    const session = this.reportingSession(id);
    if (!session || session.framesStalled) return;
    const seconds = number(stalledSeconds, 0, 3600);
    session.framesStalled = true;
    diagnostic('camera.frames-stalled', undefined, { id: session.id, seconds, bytes: session.bytes });
    this.onWarning?.(session.id, cameraFramesStalled(seconds));
  }

  reportFrameResumed(id: unknown): void {
    const session = this.reportingSession(id);
    if (!session?.framesStalled) return;
    session.framesStalled = false;
    diagnostic('camera.frames-resumed', undefined, { id: session.id, bytes: session.bytes });
    this.onRecovered?.(session.id);
  }
  async stopAndAttach(id: string, directory: string, screenStartedAt: number, screenDuration?: number): Promise<CameraAttachment> {
    const session = this.get(id);
    if (!session.format) throw new Error('摄像头编码格式尚未确认');
    const filename = `camera.${session.format.extension}`;
    session.recoveryDirectory = directory; session.preserveOnCleanup = true;
    const temporary = path.join(directory, `camera.${id}.tmp.${session.format.extension}`);
    try {
      clearInterval(session.healthTimer);
      if (session.state === 'recording') { session.state = 'stopping'; this.onCommand?.({ id, action: 'stop' }); }
      if (!['stopping', 'finished'].includes(session.state)) throw new Error('摄像头未正常开始录制');
      await this.wait(session.finished.promise, '摄像头未能及时保存，屏幕录制将单独保留');
      await this.remux(session.raw, temporary, session.format.extension);
      const info = await probeMedia(temporary);
      if (info.width <= 0 || info.height <= 0 || info.width > 8192 || info.height > 8192
        || info.width * info.height > 33_177_600 || info.duration <= 0) throw new Error('摄像头视频尺寸或时长无效');
      await fs.rename(temporary, path.join(directory, filename));
      const offset = (screenStartedAt - (session.startedAtUnixMs ?? screenStartedAt)) / 1000;
      const warning = cameraCoverageWarning(info.duration, offset, screenDuration);
      diagnostic('camera.attached', undefined, { id, offset, duration: info.duration, screenDuration, ...(warning ? { warning } : {}) });
      session.preserveOnCleanup = false;
      await this.cleanup(session);
      return { filename, offset, ...(warning ? { warnings: [warning] } : {}) };
    } catch (error) {
      // A stalled stream may still contain useful early frames. Preserve them before cancel cleans staging.
      await this.preserveRaw(session);
      throw error;
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }
  private async remux(source: string, destination: string, format: CameraContainer['extension']): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const process = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', source,
        '-map', '0:v:0', '-c:v', 'copy', '-an', '-f', format, destination], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let error = '';
      const timer = setTimeout(() => { process.kill(); reject(new Error('摄像头文件整理超时')); }, 120_000);
      process.stderr.on('data', (chunk: Buffer) => { error = (error + chunk.toString()).slice(-4000); });
      process.once('error', (failure) => { clearTimeout(timer); reject(failure); });
      process.once('close', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(error || '摄像头文件整理失败')); });
    });
  }
  async cancel(id: unknown): Promise<void> {
    const session = this.get(id);
    session.state = 'canceled';
    const error = new Error('摄像头录制已取消');
    session.started.reject(error); session.finished.reject(error);
    this.onCommand?.({ id: session.id, action: 'cancel' });
    await this.cleanup(session);
    diagnostic('camera.canceled', undefined, { id: session.id });
  }
  private async cleanup(session: CameraSession): Promise<void> {
    clearInterval(session.healthTimer);
    await session.handle?.close().catch(() => {}); session.handle = undefined;
    if (session.preserveOnCleanup && !(await this.preserveRaw(session))) {
      // If copying fails (for example a full project disk), leave the original staging file recoverable.
      if (this.session === session) this.session = undefined;
      return;
    }
    await fs.rm(session.raw, { force: true }).catch(() => {});
    await fs.rmdir(session.directory).catch(() => {});
    if (this.session === session) this.session = undefined;
  }
  private preserveRaw(session: CameraSession): Promise<boolean> {
    if (session.preserving) return session.preserving;
    if (!session.recoveryDirectory || session.bytes === 0) return Promise.resolve(true);
    session.preserving = fs.copyFile(session.raw, path.join(session.recoveryDirectory, `camera-recovery.${session.format?.extension ?? 'bin'}`))
      .then(() => { diagnostic('camera.raw-preserved', undefined, { id: session.id, bytes: session.bytes }); return true; })
      .catch(failure => { diagnostic('camera.raw-preserve-failed', failure, { id: session.id, raw: session.raw }); return false; });
    return session.preserving;
  }
  async dispose(): Promise<void> { if (this.session) await this.cancel(this.session.id); }
}
