import type { CameraRecordingApi } from '../../shared/types';
import { SwitchableCameraSource } from './switchable-camera-source';
import { WebcamFrameMonitor } from './webcam-frame-monitor';
import { WebcamRecorder } from './webcam-recorder';

/** Input readiness is checked before committing; the old camera survives a failed selection. */
export class SwitchableWebcamRecorder {
  private source: SwitchableCameraSource;
  private monitor: WebcamFrameMonitor;
  private recorder: WebcamRecorder;
  private recording = false;
  private closed = false;
  private revision = 0;
  sourceStream: MediaStream;
  constructor(readonly id: string, stream: MediaStream, private api: CameraRecordingApi, failed: (error: Error) => void) {
    this.sourceStream = stream;
    this.source = new SwitchableCameraSource(stream);
    this.monitor = this.frames(stream);
    this.recorder = new WebcamRecorder(id, this.source.stream, api, failed,
      { ready: () => this.monitor.ready(), watch: () => this.monitor.watch(), dispose: () => this.monitor.dispose() });
  }
  get stream() { return this.source.stream; }
  private frames(stream: MediaStream) {
    return new WebcamFrameMonitor(stream, {
      onStall: ms => void this.api.cameraFrameStall(this.id, ms / 1000).catch(() => {}),
      onResume: () => void this.api.cameraFrameResumed(this.id).catch(() => {}),
    });
  }
  async ready() { await this.monitor.ready(); await this.source.replace(this.sourceStream); }
  async replace(stream: MediaStream) {
    const revision = ++this.revision, next = this.frames(stream);
    try {
      await next.ready();
      if (this.closed || revision !== this.revision) throw new Error('摄像头切换已取消');
      await this.source.replace(stream);
      if (this.closed || revision !== this.revision) throw new Error('摄像头切换已取消');
      const old = this.sourceStream;
      this.monitor.dispose(); this.monitor = next; this.sourceStream = stream;
      if (this.recording) this.monitor.watch();
      old.getTracks().forEach(track => track.stop());
      await this.api.cameraFrameResumed(this.id).catch(() => {});
    } catch (error) { next.dispose(); stream.getTracks().forEach(track => track.stop()); throw error; }
  }
  async start() { await this.recorder.start(); this.recording = true; }
  async finish() { try { await this.recorder.finish(); } finally { this.close(); } }
  async cancel(notify = true) { try { await this.recorder.cancel(notify); } finally { this.close(); } }
  private close() {
    this.closed = true; this.revision++; this.monitor.dispose(); this.source.close();
    this.sourceStream.getTracks().forEach(track => track.stop());
  }
}
