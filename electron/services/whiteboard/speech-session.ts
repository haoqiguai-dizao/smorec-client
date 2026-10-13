import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { NativeClient } from '../native-client';
import { ffmpegPath } from '../ffmpeg';
import { diagnostic } from '../diagnostics';
import { SpeechModel } from './speech-model';
import { SpeechWorker } from './speech-worker';
import { boardSpeechText } from '../../../shared/whiteboard/speech-text';

const run = promisify(execFile);
interface Session { id: string; directory: string; client: NativeClient; abort: AbortController; shared: boolean }

export class SpeechSession {
  onLevel?: (id: string, level: number) => void;
  readonly model = new SpeechModel();
  private worker = new SpeechWorker(this.model);
  private current?: Session;
  private deviceId = '';
  private generation = 0;
  private starting?: number;
  private reuseMicrophone = false;
  constructor(private capture?: NativeClient) {}
  setDevice(id?: string, recordingMicrophone = false): void { this.deviceId = id ?? ''; this.reuseMicrophone = recordingMicrophone; }
  async ready(): Promise<boolean> {
    const generation = this.generation;
    const installed = await this.model.ready();
    if (installed && generation === this.generation) void this.worker.warm().catch(() => {});
    return installed;
  }
  async install(): Promise<void> {
    const generation = this.generation;
    await this.model.install();
    if (generation === this.generation) void this.worker.warm().catch(() => {});
  }
  async start(): Promise<string> {
    if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('本机语音识别支持 Windows 和 Mac');
    if (this.current || this.starting !== undefined) throw new Error('正在录音，请先松开鼠标');
    const generation = ++this.generation;
    this.starting = generation;
    const startedAt = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const id = await Promise.race([this.begin(generation), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          if (this.generation === generation) void this.cancel();
          reject(new Error('语音录入启动超过 8 秒，请检查模型或麦克风后重试'));
        }, 8000);
      })]);
      diagnostic('whiteboard.speech.start-ready', undefined, { totalMs: Math.round(performance.now() - startedAt) });
      return id;
    } catch (error) {
      if (this.generation === generation) await this.cancel();
      diagnostic('whiteboard.speech.start-failed', error, { elapsedMs: Math.round(performance.now() - startedAt) });
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.starting === generation) this.starting = undefined;
    }
  }
  private async begin(generation: number): Promise<string> {
    if (!(await this.model.ready())) throw new Error('先下载本机语音模型，或使用文字工具手动输入');
    if (generation !== this.generation) throw new Error('语音录入已取消');
    void this.worker.warm().catch(() => {});
    const directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'smorec-dictation-'));
    if (generation !== this.generation) {
      await fs.rm(directory, { recursive: true, force: true });
      throw new Error('语音录入已取消');
    }
    const shared = this.reuseMicrophone && !!this.capture;
    const session: Session = { id: randomUUID(), directory, client: shared ? this.capture! : new NativeClient(),
      abort: new AbortController(), shared };
    this.current = session;
    session.client.onDictationLevel = (id, level) => {
      if (this.current === session && id === session.id && !session.abort.signal.aborted) this.onLevel?.(id, level);
    };
    const captureStartedAt = performance.now();
    diagnostic('whiteboard.speech.starting', undefined, { sharedMicrophone: shared });
    try {
      await session.client.request(shared ? 'recording-dictation-start' : 'dictation-start',
        { directory, deviceId: this.deviceId, dictationId: session.id });
      if (this.current !== session) throw new Error('语音录入已取消');
      diagnostic('whiteboard.speech.listening', undefined, { captureStartMs: Math.round(performance.now() - captureStartedAt), sharedMicrophone: shared });
      return session.id;
    } catch (error) { await this.release(session, true); throw error; }
  }
  async stop(id: string): Promise<string> {
    const session = this.current;
    if (!session || session.id !== id) throw new Error('语音录入已结束');
    const startedAt = performance.now();
    let stoppedAt = 0, convertedAt = 0, recognizedAt = 0;
    try {
      const result = await session.client.request<{ duration: number }>(session.shared ? 'recording-dictation-stop' : 'dictation-stop',
        { dictationId: session.id });
      stoppedAt = performance.now();
      if (!(result.duration > 0.15 && result.duration <= 30.1)) throw new Error('没有检测到可用语音');
      const pcm = path.join(session.directory, 'speech.f32');
      await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-y', '-i',
        path.join(session.directory, 'microphone.wav'), '-ac', '1', '-ar', '16000', '-f', 'f32le', pcm],
      { timeout: 45_000, signal: session.abort.signal });
      convertedAt = performance.now();
      const value = boardSpeechText(await this.worker.recognize(pcm, session.abort.signal));
      recognizedAt = performance.now();
      if (!value) throw new Error('没有识别到文字，请重试或手动输入');
      return value.slice(0, 1000);
    } finally {
      await this.release(session, session.shared && !stoppedAt);
      diagnostic('whiteboard.speech.latency', undefined, {
        captureStopMs: stoppedAt ? Math.round(stoppedAt - startedAt) : undefined,
        convertMs: convertedAt ? Math.round(convertedAt - stoppedAt) : undefined,
        recognizeMs: recognizedAt ? Math.round(recognizedAt - convertedAt) : undefined,
        totalMs: Math.round(performance.now() - startedAt),
      });
    }
  }
  async cancel(): Promise<void> {
    this.generation++;
    this.starting = undefined;
    const session = this.current;
    if (session) await this.release(session, true);
  }
  async shutdown(): Promise<void> {
    this.generation++;
    this.worker.close();
    await this.cancel();
  }
  private async release(session: Session, immediate = false): Promise<void> {
    if (this.current === session) {
      this.current = undefined;
      session.client.onDictationLevel = undefined;
    }
    session.abort.abort();
    // Only a standalone dictation helper may be killed when startRunning is blocked.
    // Shared capture receives a clip-scoped cancel, and must never be respawned by cleanup.
    if (session.shared) {
      if (immediate && session.client.isRunning()) void session.client.request('recording-dictation-cancel', { dictationId: session.id })
        .catch(error => diagnostic('whiteboard.speech.cancel', error));
    } else if (immediate) session.client.dispose();
    else await session.client.shutdownGracefully();
    await fs.rm(session.directory, { recursive: true, force: true });
  }
}
