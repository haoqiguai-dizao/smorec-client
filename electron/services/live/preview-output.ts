/** Preview consumes composed frames locally and never opens a media output. */
export class PreviewOutput {
  constructor(private width: number, private height: number) {}
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async write(pixels: unknown): Promise<void> {
    if (!(pixels instanceof ArrayBuffer) && !ArrayBuffer.isView(pixels)) throw new Error('直播画面无效');
    if (pixels.byteLength !== this.width * this.height * 4) throw new Error('直播画面尺寸无效');
  }
}
export function pcmPeak(pcm?: Buffer): number {
  if (!pcm) return 0;
  let peak = 0;
  for (let offset = 0; offset + 4 <= pcm.length; offset += 4) {
    const value = pcm.readFloatLE(offset);
    if (Number.isFinite(value)) peak = Math.max(peak, Math.min(1, Math.abs(value)));
  }
  return peak;
}
