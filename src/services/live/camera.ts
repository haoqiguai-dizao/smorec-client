import type { LiveRuntimeIssue } from '../../../shared/live-issues';

/** An optional camera never controls the screen/audio output lifetime. */
export class LiveCamera {
  private video = document.createElement('video');
  private stream: MediaStream | null = null;
  private frameCallback = 0;
  private revision = 0;
  private started = 0;
  private lastFrame?: number;
  private playFailed = false;
  private unavailable = false;
  private recoveryAttempts = 0;
  private lastRecovery = -Infinity;
  constructor(private notice: (issue: LiveRuntimeIssue) => void) {
    this.video.muted = true; this.video.playsInline = true;
    Object.assign(this.video.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
    this.video.setAttribute('aria-hidden', 'true'); document.body.append(this.video);
  }
  current(stream: MediaStream | null, now: number): HTMLVideoElement | undefined {
    if (this.stream !== stream) { this.recoveryAttempts = 0; this.lastRecovery = -Infinity; this.bind(stream, now); }
    const track = stream?.getVideoTracks()[0];
    const fresh = this.lastFrame !== undefined && now - this.lastFrame <= 5000;
    const unavailable = !!stream && (this.playFailed || !track || track.readyState === 'ended'
      || track.muted || !fresh && (this.unavailable || now - this.started > 5000));
    if (this.unavailable !== unavailable) {
      this.unavailable = unavailable;
      this.notice(unavailable ? 'camera-unavailable' : 'camera-restored');
    }
    if (unavailable && track?.readyState === 'live' && !track.muted
      && (this.playFailed || now - this.started >= 5000)
      && this.recoveryAttempts < 2 && now - this.lastRecovery >= 5000) {
      this.recoveryAttempts++; this.lastRecovery = now;
      // Refresh only this consumer, never reopen or stop the physical source.
      this.video.pause(); this.video.srcObject = null; this.bind(stream, now);
      return undefined;
    }
    return stream && !unavailable && fresh && this.video.readyState >= 2 ? this.video : undefined;
  }
  private bind(stream: MediaStream | null, now: number): void {
    this.video.cancelVideoFrameCallback(this.frameCallback);
    const revision = ++this.revision;
    this.stream = stream; this.started = now; this.lastFrame = undefined; this.playFailed = false;
    this.video.srcObject = stream;
    if (!stream) return;
    let frames = 0;
    let previousTime: number | undefined;
    const observe = () => {
      this.frameCallback = this.video.requestVideoFrameCallback((_now, metadata) => {
        if (revision !== this.revision) return;
        // A retained first frame after rebinding is not evidence that capture resumed.
        if (metadata.mediaTime !== previousTime) {
          previousTime = metadata.mediaTime;
          if (++frames >= 2) {
            this.lastFrame = performance.now(); this.playFailed = false; this.recoveryAttempts = 0;
          }
        }
        observe();
      });
    };
    observe();
    // Playback can be delayed or rejected by a device. Screen output keeps its clock.
    void this.video.play().catch(() => { if (revision === this.revision) this.playFailed = true; });
  }
  dispose(): void {
    ++this.revision; this.video.cancelVideoFrameCallback(this.frameCallback);
    this.video.srcObject = null; this.video.remove(); this.stream = null;
  }
}
