/** Renderer ownership survives processing, decoding and the player's short crossfade. */
export class AudioUrlLeases {
  private counts = new Map<string, number>();
  constructor(private release: (url: string, recorder: boolean) => void) {}
  retain(url?: string, recorder = false): () => void {
    if (!url?.startsWith('frameflow://audio/')) return () => {};
    const key = `${recorder}:${url}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      const remaining = (this.counts.get(key) ?? 1) - 1;
      if (remaining) this.counts.set(key, remaining);
      else { this.counts.delete(key); this.release(url, recorder); }
    };
  }
  discard(url?: string, recorder = false): void {
    if (url?.startsWith('frameflow://audio/') && !this.counts.has(`${recorder}:${url}`)) this.release(url, recorder);
  }
}

const leases = new AudioUrlLeases((url, recorder) => {
  const api = recorder ? window.recorder : window.studio;
  void api?.releaseAudio?.(url).catch(() => {});
});
export const retainAudioUrl = (url?: string, recorder = false): (() => void) => leases.retain(url, recorder);
export const releaseAudioUrl = (url?: string, recorder = false): void => leases.discard(url, recorder);
