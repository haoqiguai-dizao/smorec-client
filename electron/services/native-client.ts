import { app } from 'electron';
import { spawn } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { RecordingState } from '../../shared/types';
import type { LiveInput } from '../../shared/live-types';
import { diagnostic } from './diagnostics';
import { captureExecutableCandidates, nativeBuildHint } from './platform/capture-runtime';
import { withSystemPermissionFocus } from './platform/system-permission-focus';
import { MacCaptureProcess } from './platform/mac-capture-process';

interface Pending { command: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
const macQueries = new Set(['capabilities', 'request-screen', 'request-input', 'request-accessibility', 'request-microphone', 'sources', 'microphone-devices', 'camera-status', 'live-applications', 'permission-settings-window']);
interface NativeProcess extends EventEmitter {
  stdin: Writable; stdout: Readable; stderr: Readable;
  pid?: number; killed: boolean; exitCode: number | null; kill(): boolean;
}
const macSessionEnds = new Set(['stop', 'live-stop', 'microphone-trial-stop', 'dictation-stop']);
const dictationCommands = new Set(['recording-dictation-start', 'recording-dictation-stop', 'recording-dictation-cancel']);
export class NativeClient {
  private child?: NativeProcess;
  private pending = new Map<string, Pending>();
  private serial = 0;
  private stderr = '';
  private queries = new Set<NativeClient>();
  onDictationLevel?: (id: string, level: number) => void;
  onState?: (state: RecordingState) => void;
  onAudioState?: (state: unknown, warning: string) => void;
  onLiveInput?: (input: LiveInput[]) => void;
  onLiveError?: (error: string) => void;
  constructor(private oneShot = false) {}

  executable(): string | undefined {
    return captureExecutableCandidates({ platform: process.platform, resourcesPath: process.resourcesPath,
      appPath: app.getAppPath() }).find(candidate => existsSync(candidate));
  }
  available(): boolean { return Boolean(this.executable()); }
  isRunning(): boolean { return Boolean(this.child && !this.child.killed && this.child.exitCode === null); }
  private ensureProcess(): NativeProcess {
    if (this.child) return this.child;
    const executable = this.executable();
    if (!executable) throw new Error(nativeBuildHint(process.platform));
    const child: NativeProcess = process.platform === 'darwin' && app.isPackaged
      ? new MacCaptureProcess(executable, path.join(process.resourcesPath, 'native/XiaoLu.Launch'), process.pid)
      : spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, FRAMEFLOW_PARENT_PID: String(process.pid) } });
    this.child = child;
    this.stderr = '';
    createInterface({ input: child.stdout }).on('line', (line) => this.receive(line));
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000);
      diagnostic('native.stderr', chunk.toString().slice(-4000));
    });
    child.on('error', (error) => { this.child = undefined; this.fail(error); });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.fail(new Error(`录制模块已退出 (${code ?? 'signal'})${this.stderr ? `：${this.stderr}` : ''}`));
    });
    return child;
  }
  private receive(line: string): void {
    try {
      const message = JSON.parse(line);
      if (message.event === 'recording-audio-state') {
        this.onAudioState?.(message.state, typeof message.warning === 'string' ? message.warning.slice(0, 1000) : '麦克风已停止，屏幕录制继续');
        return;
      }
      if (message.event === 'dictation-level') {
        if (typeof message.dictationId === 'string' && Number.isFinite(message.level))
          this.onDictationLevel?.(message.dictationId, Math.max(0, Math.min(1, message.level)));
        return;
      }
      if (message.event === 'live-input') { if (Array.isArray(message.data)) this.onLiveInput?.(message.data); return; }
      if (message.event === 'live-error') { this.onLiveError?.(String(message.error)); return; }
      if (message.event === 'state') {
        const state = typeof message.state === 'string' ? { status: message.state } : message.state;
        if (state && ['idle', 'starting', 'recording', 'stopping', 'error'].includes(state.status)) {
          if (state.status === 'error') {
            for (const [id, item] of this.pending) {
              if (!['start', 'prepare-recording', 'begin-recording', 'live-start'].includes(item.command)) continue;
              clearTimeout(item.timer);
              this.pending.delete(id);
              item.reject(new Error(typeof state.error === 'string' ? state.error : '录制模块发生错误'));
            }
          }
          this.onState?.(state);
        }
        return;
      }
      const item = this.pending.get(String(message.id));
      if (!item) return;
      clearTimeout(item.timer);
      this.pending.delete(String(message.id));
      if (message.ok) item.resolve(message.data);
      else item.reject(new Error(typeof message.error === 'string' ? message.error : '录制模块发生错误'));
    } catch { /* Ignore a helper diagnostic that is not a protocol message. */ }
  }
  private fail(error: Error): void {
    diagnostic('native.failure', error);
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
    this.onState?.({ status: 'error', error: error.message });
  }
  async request<T>(command: string, extra: Record<string, unknown> = {}): Promise<T> {
    // macOS caches privacy decisions in the process. Settings probes must not poison
    // the next capture with an earlier denial or recycle a helper that is recording.
    if (process.platform === 'darwin' && !this.oneShot && macQueries.has(command)) {
      const query = new NativeClient(true);
      this.queries.add(query);
      try {
        if (command === 'sources' || command === 'live-applications') {
          const status = await query.request<{ screenPermission: boolean }>('capabilities');
          if (!status.screenPermission) return await withSystemPermissionFocus(() => query.request<T>(command, extra));
        }
        return await query.request<T>(command, extra);
      }
      finally { await query.shutdownGracefully(); this.queries.delete(query); }
    }
    const result = await this.send<T>(command, extra);
    // Each Mac capture starts in a fresh process after the user has granted access.
    if (process.platform === 'darwin' && macSessionEnds.has(command)) await this.shutdownGracefully();
    return result;
  }
  private send<T>(command: string, extra: Record<string, unknown>): Promise<T> {
    const child = this.ensureProcess();
    const id = String(++this.serial);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const scoped = dictationCommands.has(command);
        const error = new Error(scoped ? '白板语音响应超时，请取消后重试；屏幕录制继续'
          : '录制模块响应超时，正在结束并保留已有素材，请重试');
        // Reject the timed-out request before shutting down the helper. Otherwise
        // shutdownGracefully replaces the actionable timeout with its generic
        // "saving existing material" message and the launcher loses the cause.
        const item = this.pending.get(id);
        if (!item) return;
        this.pending.delete(id);
        clearTimeout(item.timer);
        item.reject(error);
        // Optional dictation must never tear down the main screen/camera session.
        if (scoped) return;
        this.fail(error);
        void this.shutdownGracefully();
      }, dictationCommands.has(command) ? 7000 : command === 'stop' ? 120_000 : 45_000);
      this.pending.set(id, { command, resolve: (value) => resolve(value as T), reject, timer });
      child.stdin.write(`${JSON.stringify({ id, command, ...extra })}\n`, (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  async shutdownGracefully(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    diagnostic('native.graceful-shutdown', undefined, { pid: child.pid });
    for (const item of this.pending.values()) {
      clearTimeout(item.timer); item.reject(new Error('录制模块正在结束并保存已有素材'));
    }
    this.pending.clear();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 15_000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.stdin.end();
    });
  }
  dispose(): void {
    for (const query of this.queries) query.dispose();
    this.queries.clear();
    const child = this.child;
    this.child = undefined;
    child?.kill();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('应用正在退出')); }
    this.pending.clear();
  }
}
