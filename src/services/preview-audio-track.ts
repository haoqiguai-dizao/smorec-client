/** A replaceable audio stem. Candidates decode and align silently before a short crossfade. */
interface Entry {
  element: HTMLAudioElement;
  release: () => void;
  fade?: ReturnType<typeof setInterval>;
}
export class PreviewAudioTrack {
  private active?: Entry;
  private candidate?: Entry;
  private retiring?: Entry;
  private requested?: string;
  private playing = false;
  private gain = 0;
  private starting = false;
  constructor(private name: string, private elements: Record<string, HTMLAudioElement>,
    private sourceTime: () => number, private changed: () => void, private error: (message: string) => void,
    private create: () => HTMLAudioElement, private retain: (url: string) => () => void = () => () => {}) {}

  get url(): string | undefined { return this.active?.element.getAttribute('src') ?? undefined; }
  get ready(): boolean { return !!this.active; }

  update(url: string | undefined, playing: boolean): void {
    const resumed = playing && !this.playing;
    this.playing = playing;
    if (!playing) for (const entry of [this.active, this.candidate, this.retiring]) entry?.element.pause();
    if (url !== this.requested) {
      this.requested = url; this.discard(this.candidate); this.candidate = undefined; this.starting = false;
      if (!url) { this.discard(this.active); this.discard(this.retiring); this.active = this.retiring = undefined; return; }
      if (url !== this.url) {
        const element = this.create();
        const releaseUrl = this.retain(url);
        element.crossOrigin = 'anonymous'; element.preload = 'auto'; element.volume = 0;
        const align = () => {
          if (Number.isFinite(element.duration)) element.currentTime = Math.min(this.sourceTime(), element.duration);
        };
        const ready = () => this.activate();
        const failed = () => {
          if (this.candidate?.element === element) { this.discard(this.candidate); this.candidate = undefined; this.starting = false; }
          this.error(`${this.name === 'mix' ? '混音' : this.name === 'system' ? '系统' : '麦克风'}音轨无法读取`);
        };
        element.addEventListener('loadedmetadata', align); element.addEventListener('canplay', ready);
        element.addEventListener('seeked', ready); element.addEventListener('error', failed);
        this.candidate = { element, release: () => {
          element.removeEventListener('loadedmetadata', align); element.removeEventListener('canplay', ready);
          element.removeEventListener('seeked', ready); element.removeEventListener('error', failed);
          releaseUrl();
        } };
        this.elements[`${this.name}:next`] = element; element.src = url;
      }
    }
    if (resumed && this.active) this.resume(this.active);
    this.activate();
  }

  private resume(entry: Entry): void {
    const element = entry.element;
    if (Number.isFinite(element.duration)) element.currentTime = Math.min(this.sourceTime(), element.duration);
    if (!Number.isFinite(element.duration) || this.sourceTime() < element.duration) {
      void element.play().catch(cause => {
        if (this.playing && this.active === entry && cause?.name !== 'AbortError') this.error('声音播放失败，请重试');
      });
    }
  }

  private activate(): void {
    const next = this.candidate;
    if (!next || this.starting || next.element.readyState < 2 || next.element.seeking) return;
    const element = next.element, target = Math.min(this.sourceTime(), element.duration);
    if (Number.isFinite(target) && Math.abs(element.currentTime - target) > .06) { element.currentTime = target; return; }
    const adopt = () => {
      if (this.candidate !== next) return;
      this.starting = false;
      if (this.playing && !element.ended && Math.abs(element.currentTime - this.sourceTime()) > .08) { this.activate(); return; }
      if (!this.playing) element.pause();
      this.discard(this.retiring);
      const previous = this.active;
      this.active = next; this.candidate = undefined; this.retiring = previous;
      delete this.elements[`${this.name}:next`]; this.elements[this.name] = element;
      if (previous) {
        this.elements[`${this.name}:old`] = previous.element;
        this.ramp(previous, 0, this.playing, () => {
          if (this.retiring === previous) { this.discard(previous); this.retiring = undefined; }
        });
      }
      this.ramp(next, this.gain, this.playing); this.changed();
    };
    if (!this.playing || this.sourceTime() >= element.duration) { adopt(); return; }
    this.starting = true;
    void element.play().then(adopt).catch(cause => {
      if (this.candidate !== next) return;
      this.starting = false;
      if (cause?.name === 'AbortError') { if (!this.playing) this.activate(); }
      else { this.discard(next); this.candidate = undefined; this.error('声音播放失败，请重试'); }
    });
  }

  setGain(gain: number, smooth = false): void {
    if (this.gain === gain) return;
    this.gain = gain;
    if (this.active) this.ramp(this.active, gain, smooth && this.playing);
    // A mute applies to fading-out sources too; stale settings must never leak sound.
    if (!gain && !smooth && this.retiring) { this.discard(this.retiring); this.retiring = undefined; }
  }

  private ramp(entry: Entry, gain: number, smooth: boolean, done?: () => void): void {
    clearInterval(entry.fade);
    if (!smooth) { entry.element.volume = gain; done?.(); return; }
    const from = entry.element.volume, began = performance.now();
    entry.fade = setInterval(() => {
      const fraction = Math.min(1, (performance.now() - began) / 40);
      entry.element.volume = from + (gain - from) * fraction;
      if (fraction === 1) { clearInterval(entry.fade); done?.(); }
    }, 10);
  }

  private discard(entry?: Entry): void {
    if (!entry) return;
    clearInterval(entry.fade); entry.release(); entry.element.pause();
    entry.element.removeAttribute('src'); entry.element.load();
    for (const key of Object.keys(this.elements)) if (this.elements[key] === entry.element) delete this.elements[key];
  }
  dispose(): void {
    this.playing = false; this.requested = undefined;
    this.discard(this.active); this.discard(this.candidate); this.discard(this.retiring);
    this.active = this.candidate = this.retiring = undefined;
  }
}
