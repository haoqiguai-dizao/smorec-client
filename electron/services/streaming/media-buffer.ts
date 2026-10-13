/** Bounded media history, indexed by the native capture clock, shared by every reconnect. */
export class StreamMediaBuffer {
  private frames: { time: number; pixels: Buffer }[] = [];
  private samples = new Float32Array(48000 * 2 * 3);
  private stamps = new Float64Array(48000 * 3).fill(-1);
  private audioEnd?: number;
  dropped = 0;
  get latestTime(): number | undefined { return this.frames.at(-1)?.time; }
  get latestAudioTime(): number | undefined { return this.audioEnd; }
  video(pixels: ArrayBuffer, time: number): void {
    if (!Number.isFinite(time) || time < 0) throw new Error('推流画面时钟无效');
    this.frames.push({ time, pixels: Buffer.from(new Uint8Array(pixels)) });
    if (this.frames.length > 12) { this.frames.shift(); this.dropped++; }
  }
  audio(data: Buffer, time: number): void {
    if (!Number.isFinite(time) || time < 0 || data.length % 8 || data.length > 48000 * 8 / 2) throw new Error('推流音频格式无效');
    const start = Math.round(time * 48000);
    this.audioEnd = Math.max(this.audioEnd ?? 0, (start + data.length / 8) / 48000);
    for (let index = 0; index < data.length / 8; index++) {
      const frame = start + index, slot = frame % this.stamps.length;
      this.stamps[slot] = frame;
      for (let channel = 0; channel < 2; channel++) {
        const sample = data.readFloatLE(index * 8 + channel * 4);
        this.samples[slot * 2 + channel] = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0;
      }
    }
  }
  takeVideo(time: number): Buffer | undefined {
    while (this.frames.length > 1 && this.frames[1].time <= time) this.frames.shift();
    return this.frames[0]?.pixels;
  }
  takeAudio(time: number, count: number): Buffer {
    const start = Math.round(time * 48000), data = Buffer.alloc(count * 8);
    for (let index = 0; index < count; index++) {
      const frame = start + index, slot = ((frame % this.stamps.length) + this.stamps.length) % this.stamps.length;
      if (this.stamps[slot] !== frame) continue;
      data.writeFloatLE(this.samples[slot * 2], index * 8);
      data.writeFloatLE(this.samples[slot * 2 + 1], index * 8 + 4);
    }
    return data;
  }
  clear(): void { this.frames = []; this.samples.fill(0); this.stamps.fill(-1); this.audioEnd = undefined; }
}
