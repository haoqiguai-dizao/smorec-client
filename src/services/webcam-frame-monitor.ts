export interface WebcamFrames {
  ready(): Promise<void>;
  watch(): void;
  dispose(): void;
}

/** Frame liveness, which the main process byte-level chunk health cannot observe. */
export interface WebcamFrameEvents {
  onStall?: (stalledMs: number) => void;
  onResume?: () => void;
}

const STALL_MS = 5000;

/** A recording-owned consumer, independent of settings panels and their effects canvas. */
export class WebcamFrameMonitor implements WebcamFrames {
  private readonly video: HTMLVideoElement;
  private callback = 0;
  private timer: ReturnType<typeof setInterval>;
  private frames = 0;
  private presented = 0;
  private lastFrameAt = performance.now();
  private lastRecoveryAt = 0;
  private reportedStall = false;
  private watching = false;
  private disposed = false;
  private recoveryAttempts = 0;
  private readyWaiters = new Set<() => void>();
  private playbackError?: Error;

  constructor(private stream: MediaStream, private events: WebcamFrameEvents = {}) {
    const video = document.createElement('video');
    this.video = video;
    video.muted = true; video.autoplay = true; video.playsInline = true;
    video.setAttribute('aria-hidden', 'true');
    video.dataset.cameraFrameMonitor = 'true';
    // Keep the consumer attached while its owning BrowserWindow is hidden. It never paints into a recording.
    Object.assign(video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
    document.body.append(video);
    video.srcObject = stream;
    this.play(); this.schedule();
    this.timer = setInterval(() => this.check(), 1000);
  }

  private play() {
    void this.video.play().catch(error => {
      if (!this.disposed) this.playbackError = error instanceof Error ? error : new Error(String(error));
    });
  }

  private schedule() {
    if (this.disposed) return;
    this.callback = this.video.requestVideoFrameCallback((_now, metadata) => {
      if (metadata.presentedFrames !== this.presented) {
        this.presented = metadata.presentedFrames;
        this.frames++;
        this.lastFrameAt = performance.now();
        this.recoveryAttempts = 0;
        this.playbackError = undefined;
        this.video.dataset.frames = String(this.frames);
        this.video.dataset.frameTime = String(metadata.mediaTime);
        this.readyWaiters.forEach(check => check());
      }
      this.schedule();
    });
  }

  ready(): Promise<void> {
    const initial = this.frames;
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout); this.readyWaiters.delete(check);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (this.disposed) finish(new Error('摄像头会话已取消'));
        else if (this.frames >= initial + 2) finish();
      };
      const timeout = setTimeout(() => finish(this.playbackError ?? new Error('摄像头没有持续送来画面，请重新连接设备后再录制')), 5000);
      this.readyWaiters.add(check); check();
    });
  }

  watch() { this.watching = true; this.lastFrameAt = performance.now(); }

  private check() {
    if (this.disposed || !this.watching) return;
    const stalledMs = performance.now() - this.lastFrameAt;
    if (stalledMs < STALL_MS) {
      // Frames are live again; clear only the stall notice this monitor raised.
      if (this.reportedStall) { this.reportedStall = false; this.events.onResume?.(); }
      return;
    }
    if (!this.reportedStall) { this.reportedStall = true; this.events.onStall?.(stalledMs); }
    // Bounded consumer refresh. It never touches the recorder's track, and it never masks the stall
    // report, so an encoder that stays stalled keeps warning instead of falling silent after two tries.
    if (this.recoveryAttempts >= 2 || performance.now() - this.lastRecoveryAt < STALL_MS) return;
    this.recoveryAttempts++;
    this.lastRecoveryAt = performance.now();
    const track = this.stream.getVideoTracks()[0];
    console.warn('Camera frames stalled; reconnecting the existing video consumer', {
      frames: this.frames, attempt: this.recoveryAttempts, readyState: track?.readyState,
      muted: track?.muted, videoReadyState: this.video.readyState,
    });
    // Refresh only this consumer. Never stop/reacquire the source or replace the recorder's raw track.
    this.video.cancelVideoFrameCallback(this.callback);
    this.video.pause(); this.video.srcObject = null;
    this.presented = 0;
    this.video.srcObject = this.stream;
    this.play(); this.schedule();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.timer);
    this.video.cancelVideoFrameCallback(this.callback);
    this.readyWaiters.forEach(check => check());
    this.video.pause(); this.video.srcObject = null; this.video.remove();
  }
}
