import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { diagnostic } from '../diagnostics';
import { SpeechModel } from './speech-model';

interface Reply { ready?: boolean; ok?: boolean; code?: number; text?: string }
interface Pending { resolve: (value: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

export class SpeechWorker {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private ready?: () => void;
  private rejectReady?: (error: Error) => void;
  private pending?: Pending;

  constructor(private model: SpeechModel) {}

  warm(): Promise<void> {
    if (this.starting) return this.starting;
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'speech', process.platform === 'win32' ? 'XiaoLu.Speech.exe' : 'XiaoLu.Speech')
      : process.platform === 'win32' ? path.join(app.getAppPath(), 'native', 'speech-publish', 'XiaoLu.Speech.exe')
        : path.join(app.getAppPath(), 'native', 'macos', '.build', 'release', 'speech', 'XiaoLu.Speech');
    const { model, tokens } = this.model.paths();
    const startedAt = performance.now();
    const child = spawn(executable, ['--server', model, tokens], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout });
    child.stderr.resume();
    child.once('error', () => { if (this.child === child) this.close(new Error('本机识别程序启动失败')); });
    child.once('exit', () => { if (this.child === child) this.close(new Error('本机识别程序意外退出')); });
    lines.on('line', line => { if (this.child === child) this.receive(line); });
    this.starting = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('本机语音模型加载超时')), 30_000);
      this.ready = () => { clearTimeout(timer); this.ready = undefined; this.rejectReady = undefined;
        diagnostic('whiteboard.speech.model-ready', undefined, { loadMs: Math.round(performance.now() - startedAt) }); resolve(); };
      this.rejectReady = error => { clearTimeout(timer); this.ready = undefined; this.rejectReady = undefined; reject(error); };
    });
    return this.starting;
  }

  async recognize(pcm: string, signal: AbortSignal): Promise<string> {
    await this.warm();
    if (signal.aborted) throw new Error('语音录入已取消');
    if (!this.child || this.pending || /[\r\n]/.test(pcm)) throw new Error('本机识别程序不可用');
    return new Promise<string>((resolve, reject) => {
      const abort = () => this.close(new Error('语音录入已取消'));
      signal.addEventListener('abort', abort, { once: true });
      const finish = (value?: string, error?: Error) => {
        signal.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value ?? '');
      };
      const timer = setTimeout(() => this.close(new Error('本机语音识别超时')), 90_000);
      this.pending = { resolve: value => finish(value), reject: error => finish(undefined, error), timer };
      this.child!.stdin.write(`${pcm}\n`, error => {
        if (error) this.close(new Error('本机识别程序通信失败'));
      });
    });
  }

  close(error = new Error('本机识别程序已关闭')): void {
    const child = this.child;
    this.child = undefined; this.starting = undefined;
    this.rejectReady?.(error);
    const pending = this.pending;
    this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(error); }
    if (child && !child.killed) child.kill();
  }

  private receive(line: string): void {
    let reply: Reply;
    try { reply = JSON.parse(line) as Reply; }
    catch { this.close(new Error('本机识别程序返回无效结果')); return; }
    if (this.ready) {
      if (reply.ready === true) this.ready();
      else this.close(new Error('本机语音模型加载失败'));
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined; clearTimeout(pending.timer);
    if (reply.ok && typeof reply.text === 'string') pending.resolve(reply.text);
    else pending.reject(new Error(reply.code === 6 ? '没有检测到语音，请重试或手动输入' : '本机语音识别失败'));
  }
}
