interface MediaClock { currentTime: number; duration: number }

/** Follow the decoder until its final frame, then advance only the held presentation tail. */
export class PlaybackClock {
  private tail: { source: number; at: number } | null = null;
  private running = false;
  constructor(private now: () => number = () => performance.now()) {}

  get holding(): boolean { return this.tail !== null; }
  read(media: MediaClock): number {
    return this.tail ? this.tail.source + (this.running ? (this.now() - this.tail.at) / 1000 : 0) : media.currentTime;
  }
  seek(source: number, duration: number): void {
    this.tail = Number.isFinite(duration) && source >= duration ? { source, at: this.now() } : null;
  }
  ended(duration: number): void {
    if (!this.tail && Number.isFinite(duration)) this.tail = { source: duration, at: this.now() };
  }
  play(): void {
    if (this.tail) this.tail.at = this.now();
    this.running = true;
  }
  pause(media: MediaClock): void {
    if (this.tail) this.tail = { source: this.read(media), at: this.now() };
    this.running = false;
  }
  reset(): void { this.tail = null; this.running = false; }
}
