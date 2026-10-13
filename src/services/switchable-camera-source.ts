/** A stable encoding track keeps MediaRecorder alive while its physical input changes. */
export class SwitchableCameraSource {
  readonly stream: MediaStream;
  private canvas = document.createElement('canvas');
  private video?: HTMLVideoElement;
  private callback = 0;
  private closed = false;
  private revision = 0;
  constructor(input: MediaStream) {
    const settings = input.getVideoTracks()[0].getSettings();
    this.canvas.width = settings.width ?? 1280; this.canvas.height = settings.height ?? 720;
    this.stream = this.canvas.captureStream(Math.max(1, Math.min(60, settings.frameRate ?? 30)));
  }
  async replace(input: MediaStream) {
    const revision = ++this.revision, video = document.createElement('video');
    video.muted = true; video.autoplay = true; video.playsInline = true; video.srcObject = input;
    try {
      await video.play();
      if (this.closed || revision !== this.revision || !input.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('摄像头切换已取消');
      const previous = this.video;
      if (previous) { previous.cancelVideoFrameCallback(this.callback); previous.pause(); previous.srcObject = null; }
      this.video = video; this.paint();
    } catch (error) { video.pause(); video.srcObject = null; throw error; }
  }
  private paint() {
    const video = this.video;
    if (!video || this.closed) return;
    const context = this.canvas.getContext('2d')!;
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const scale = Math.min(this.canvas.width / video.videoWidth, this.canvas.height / video.videoHeight);
      const width = video.videoWidth * scale, height = video.videoHeight * scale;
      context.fillStyle = '#000'; context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      context.drawImage(video, (this.canvas.width - width) / 2, (this.canvas.height - height) / 2, width, height);
    }
    this.callback = video.requestVideoFrameCallback(() => this.paint());
  }
  close() {
    this.closed = true; this.revision++;
    if (this.video) { this.video.cancelVideoFrameCallback(this.callback); this.video.pause(); this.video.srcObject = null; }
    this.stream.getTracks().forEach(track => track.stop());
  }
}
