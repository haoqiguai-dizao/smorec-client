import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { StreamConnection, StreamProfile } from '../../../shared/streaming';
import { StreamAudioChannel } from './audio-channel';
import { streamArguments, scrubStreamError, streamFailure } from './encoding';
import { chooseStreamEncoder } from './encoder';
import { StreamMediaBuffer } from './media-buffer';
import { StreamTLSRelay } from './tls-relay';
import type { StreamProxyResolver } from './proxy-routing';

interface Options {
  executable: string; profile: StreamProfile;
  caFile?: string;
  env?: NodeJS.ProcessEnv;
  resolveProxy?: StreamProxyResolver;
  diagnostic?: (message: string) => void;
  changed(state: StreamConnection): void; failed(error: Error): void;
}
const ENCODER_PROGRESS_TIMEOUT_MS = 10000;
interface Attempt {
  child: ChildProcessWithoutNullStreams; audio: StreamAudioChannel; relay?: StreamTLSRelay;
  ended: boolean; timer?: ReturnType<typeof setTimeout>; frames: number; progressAt: number;
}
export class StreamWriter {
  private media = new StreamMediaBuffer();
  private attempt?: Attempt;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private pulse?: ReturnType<typeof setInterval>;
  private wakePending = false;
  private stopped = false;
  private width = 0; private height = 0;
  private encoder = 'libx264';
  private reconnects = 0;
  private origin?: number;
  private tick = 0;
  private started = 0;
  private failures = 0;
  private audioTick = 0;
  private videoWriteStarted?: number;
  private audioWriteStarted?: number;
  private connecting?: Promise<void>;
  private closing?: Promise<void>;
  private retiring = new Set<Promise<void>>();
  private connection: StreamConnection = { status: 'connecting', attempt: 0, bitrate: 0, frames: 0, dropped: 0 };
  constructor(private options: Options) {}
  private publish(update: Partial<StreamConnection>): void {
    if (this.stopped) return;
    this.connection = { ...this.connection, dropped: this.media.dropped, ...update };
    this.options.changed({ ...this.connection });
  }
  async start(width: number, height: number, fps: number): Promise<void> {
    if (this.attempt || this.stopped || fps !== this.options.profile.fps || width < 2 || height < 2)
      throw new Error('推流输出规格无效');
    this.width = width; this.height = height;
    this.encoder = await chooseStreamEncoder(this.options.executable, width, height, fps, this.options.profile.bitrate);
    if (this.stopped) throw new Error('推流启动已取消');
    await this.connect();
    if (this.stopped) throw new Error('推流启动已取消');
    this.pulse = setInterval(() => this.send(), Math.max(2, Math.floor(1000 / fps / 2)));
  }
  private connect(): Promise<void> {
    const pending = this.openConnection();
    this.connecting = pending;
    return pending.finally(() => { if (this.connecting === pending) this.connecting = undefined; });
  }
  private async openConnection(): Promise<void> {
    const routes = await this.options.resolveProxy?.(this.options.profile.server).catch(error => {
      const message = scrubStreamError(String(error), this.options.profile);
      this.options.diagnostic?.(message);
      throw new Error(streamFailure(message).message);
    }) ?? [{ kind: 'direct' as const }];
    const audio = new StreamAudioChannel();
    let attempt: Attempt | undefined, transportError = '';
    const relay = (process.platform === 'darwin' && /^rtmps:/i.test(this.options.profile.server)) || routes.some(route => route.kind !== 'direct')
      ? new StreamTLSRelay(this.options.profile, this.options.caFile, reason => {
        transportError = reason;
        if (attempt) this.disconnected(attempt, reason);
      }, routes) : undefined;
    try {
      const audioURL = await audio.open();
      const transport = await relay?.open();
      if (this.stopped) { await audio.close(); await relay?.close(); return; }
      const child = spawn(this.options.executable, streamArguments(this.options.profile, this.width, this.height, audioURL, this.encoder, this.options.caFile, transport),
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: this.options.env });
      const current: Attempt = attempt = { child, audio, relay, ended: false, frames: 0, progressAt: performance.now() };
      this.attempt = attempt; this.origin = undefined; this.tick = 0; this.audioTick = 0;
      this.videoWriteStarted = undefined; this.audioWriteStarted = undefined;
      this.publish({ status: this.reconnects ? 'reconnecting' : 'connecting', attempt: this.reconnects, error: undefined, bitrate: 0, frames: 0 });
      let stderr = '';
      child.stderr.on('data', bytes => { stderr = scrubStreamError(stderr + bytes.toString(), this.options.profile); });
      child.stdin.on('error', () => { if (!current.ended) child.kill(); });
      child.on('error', () => this.disconnected(current, transportError || stderr));
      child.on('close', () => this.disconnected(current, transportError || stderr));
      const progress = createInterface({ input: child.stdout });
      let frame = 0, bitrate = 0;
      progress.on('line', line => {
        if (this.attempt !== current || current.ended) return;
        const [key, value] = line.split('=');
        if (key === 'frame') frame = Number(value) || 0;
        if (key === 'bitrate') bitrate = Number.parseFloat(value) || 0;
        if (key === 'progress' && frame > 0) {
          clearTimeout(current.timer);
          if (frame > current.frames) { current.frames = frame; current.progressAt = performance.now(); }
          if (frame > this.options.profile.fps * 10) this.failures = 0;
          this.publish({ status: 'streaming', bitrate, frames: frame, error: undefined });
        }
      });
      current.timer = setTimeout(() => this.disconnected(current, 'connection timeout'), 20000);
    } catch {
      await audio.close(); await relay?.close();
      if (!this.stopped) throw new Error('推流音视频输出组件未能启动');
    }
  }
  audio(data: Buffer, time: number): void { this.media.audio(data, time); this.wake(); }
  async write(value: unknown, time = 0): Promise<void> {
    if (this.stopped || !(value instanceof ArrayBuffer) || value.byteLength !== this.width * this.height * 4)
      throw new Error('推流输出帧无效');
    this.media.video(value, time);
    this.wake();
  }
  private wake(): void {
    if (this.stopped || this.wakePending) return;
    this.wakePending = true;
    setImmediate(() => { this.wakePending = false; this.send(); });
  }
  private send(): void {
    const attempt = this.attempt, latest = this.media.latestTime, audioEnd = this.media.latestAudioTime;
    if (this.stopped || !attempt || attempt.ended || !attempt.audio.socket || latest === undefined || audioEnd === undefined) return;
    const { child, audio } = attempt;
    if (child.stdin.destroyed || audio.socket!.destroyed) { child.kill(); return; }
    if (this.origin === undefined) {
      this.origin = Math.max(0, Math.min(latest - .12, audioEnd - 2 / this.options.profile.fps));
      this.started = performance.now();
    }
    const now = performance.now(), fps = this.options.profile.fps;
    const due = Math.floor((now - this.started) * fps / 1000);
    // A pending pipe write is normal flow control. Only advancing encoded frames
    // prove output progress; repeated progress lines and input writes do not.
    if (this.connection.status === 'streaming' && now - attempt.progressAt >= ENCODER_PROGRESS_TIMEOUT_MS) {
      const pending = (time?: number) => time === undefined ? 0 : Math.round(now - time);
      this.disconnected(attempt, `encoder output stalled: frames=${attempt.frames}, idleMs=${Math.round(now - attempt.progressAt)}, `
        + `videoPendingMs=${pending(this.videoWriteStarted)}, audioPendingMs=${pending(this.audioWriteStarted)}`); return;
    }
    const done = (kind: 'video' | 'audio') => (error?: Error | null) => {
      if (this.attempt !== attempt || attempt.ended) return;
      if (kind === 'video') this.videoWriteStarted = undefined;
      else this.audioWriteStarted = undefined;
      if (error) attempt.child.kill();
      else this.wake();
    };
    // FFmpeg may wait for a complete PCM packet before draining video. Keep the
    // pipes independent, one write each, with audio at most half a second ahead.
    const audioTime = this.origin + this.audioTick / fps;
    if (this.audioWriteStarted === undefined && this.audioTick <= due
      && this.audioTick < this.tick + fps / 2 && audioTime + 1 / fps <= audioEnd + 1 / 48000) {
      this.audioWriteStarted = now;
      audio.socket!.write(this.media.takeAudio(audioTime, 48000 / fps), done('audio')); this.audioTick++;
    }
    // Raw input packets carry wall-clock timestamps. Skip missed input slots;
    // FFmpeg maintains output CFR without replaying an ever-older capture clock.
    const videoTime = this.origin + due / fps;
    if (this.videoWriteStarted === undefined && this.tick <= due && this.tick < this.audioTick) {
      const video = this.media.takeVideo(videoTime);
      if (video) { this.videoWriteStarted = now; child.stdin.write(video, done('video')); this.tick = due + 1; }
    }
  }
  private disconnected(attempt: Attempt, stderr: string): void {
    if (this.stopped || attempt !== this.attempt || attempt.ended) return;
    attempt.ended = true; clearTimeout(attempt.timer);
    const retiring = this.release(attempt, false).catch(() => {}).finally(() => this.retiring.delete(retiring));
    this.retiring.add(retiring);
    this.attempt = undefined; this.origin = undefined;
    this.options.diagnostic?.(scrubStreamError(stderr, this.options.profile));
    const reason = streamFailure(stderr);
    if (!reason.retry || ++this.failures > 5) {
      this.publish({ status: 'failed', error: reason.message });
      this.options.failed(new Error(reason.message)); return;
    }
    this.reconnects++;
    this.publish({ status: 'reconnecting', attempt: this.reconnects, error: reason.message, bitrate: 0 });
    this.retryTimer = setTimeout(() => {
      if (this.stopped) return;
      void this.connect().catch(() => {
        if (!this.stopped) this.options.failed(new Error('推流重连失败，请重新开始'));
      });
    }, Math.min(15000, 1000 * 2 ** (this.failures - 1)));
  }
  stop(): Promise<void> {
    return this.closing ??= this.close();
  }
  private async close(): Promise<void> {
    this.stopped = true; clearInterval(this.pulse); clearTimeout(this.retryTimer);
    const attempt = this.attempt; this.attempt = undefined;
    this.media.clear();
    if (attempt) { attempt.ended = true; clearTimeout(attempt.timer); await this.release(attempt, true); }
    await this.connecting?.catch(() => {});
    await Promise.all(this.retiring);
  }
  private async release(attempt: Attempt, graceful: boolean): Promise<void> {
    if (graceful) { attempt.child.stdin.end(); attempt.audio.socket?.end(); }
    else attempt.child.kill();
    await new Promise<void>(resolve => {
      if (attempt.child.exitCode !== null || attempt.child.signalCode !== null) { resolve(); return; }
      // A demuxer blocked in a socket read can ignore SIGTERM; do not leave it behind on stop/retry.
      const timer = setTimeout(() => attempt.child.kill('SIGKILL'), 2000);
      attempt.child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    await attempt.audio.close();
    await attempt.relay?.close();
  }
}
