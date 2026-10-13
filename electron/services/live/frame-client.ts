import { createConnection, type Socket } from 'node:net';
import { liveFrameAddress } from '../platform/live-address';

export class LiveFrameClient {
  private socket?: Socket;
  private pending?: { resolve: (time: number) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private header = Buffer.alloc(24);
  private audioHeader = Buffer.alloc(16);
  readonly pixels: Buffer;
  audio?: Buffer;
  audioTime = 0;
  private offset = 0;
  private time = 0;
  private stage: 'header' | 'pixels' | 'audio-header' | 'audio' = 'header';
  constructor(readonly width: number, readonly height: number, private withAudio = false) { this.pixels = Buffer.alloc(width * height * 4); }
  async connect(name: string): Promise<void> {
    const socket = this.socket = createConnection(liveFrameAddress(name));
    socket.on('data', bytes => this.receive(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)));
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('直播采集通道已关闭')));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('直播采集连接超时')); }, 5000);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
  }
  private receive(bytes: Buffer): void {
    try {
      let read = 0;
      while (read < bytes.length) {
        if (!this.pending) throw new Error('收到未请求的直播媒体数据');
        const target = this.stage === 'header' ? this.header : this.stage === 'pixels' ? this.pixels
          : this.stage === 'audio-header' ? this.audioHeader : this.audio!;
        const count = Math.min(bytes.length - read, target.length - this.offset);
        if (count <= 0) throw new Error('直播媒体长度无效');
        bytes.copy(target, this.offset, read, read + count); read += count; this.offset += count;
        if (this.offset !== target.length) continue;
        this.offset = 0;
        if (this.stage === 'header') {
          if (this.header.readUInt32LE(0) !== 0x584c4652 || this.header.readUInt32LE(4) !== this.width
            || this.header.readUInt32LE(8) !== this.height || this.header.readUInt32LE(12) !== this.pixels.length) throw new Error('直播帧格式无效');
          this.time = this.header.readDoubleLE(16);
          if (!Number.isFinite(this.time) || this.time < 0) throw new Error('直播时钟无效');
          this.stage = 'pixels';
        } else if (this.stage === 'pixels' && this.withAudio) this.stage = 'audio-header';
        else if (this.stage === 'audio-header') {
          const length = this.audioHeader.readUInt32LE(4);
          this.audioTime = this.audioHeader.readDoubleLE(8);
          if (this.audioHeader.readUInt32LE(0) !== 0x584c4155 || length > 48000 * 8 / 2 || length % 8
            || !Number.isFinite(this.audioTime) || this.audioTime < 0 || this.audioTime > this.time + .1) throw new Error('直播声音格式无效');
          this.audio = Buffer.alloc(length);
          if (length) this.stage = 'audio'; else this.finish();
        } else this.finish();
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error('直播媒体数据无效')); this.socket?.destroy(); }
  }
  private finish(): void {
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.resolve(this.time); }
  }
  pull(): Promise<number> {
    if (this.pending) return Promise.reject(new Error('上一帧尚未完成'));
    if (!this.socket || this.socket.destroyed) return Promise.reject(new Error('直播采集已停止'));
    this.offset = 0; this.stage = 'header'; this.audio = undefined;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.fail(new Error('直播画面响应超时')); this.socket?.destroy(); }, 5000);
      this.pending = { resolve, reject, timer };
      this.socket!.write(Buffer.from([1]), error => { if (error) this.fail(error); });
    });
  }
  private fail(error: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined;
  }
  close(): void { this.fail(new Error('直播已结束')); this.socket?.destroy(); this.socket = undefined; }
}
