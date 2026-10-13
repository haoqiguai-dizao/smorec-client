import type { CameraRecordingApi } from '../../shared/types';
import { WebcamFrameMonitor, type WebcamFrames } from './webcam-frame-monitor';
import { cameraRecorderOptions } from './camera-recorder-options';
import { cameraContainer } from '../../shared/camera-container';
import { startCameraMediaRecorder } from './camera-recorder-start';

/** Owns the camera track across dialog dismissal, window minimization and native stop. */
export class WebcamRecorder {
  private recorder: MediaRecorder | null = null;
  private writes = Promise.resolve();
  private failure: Error | null = null;
  private finishing: Promise<void> | null = null;
  private canceling: Promise<void> | null = null;
  private canceled = false;
  private stopRequested = false;
  private flushTimer?: ReturnType<typeof setInterval>;
  private acknowledged = Promise.resolve();
  private rejectAcknowledgement?: (error: Error) => void;
  private frames: WebcamFrames;
  private ended = () => this.fail(new Error('摄像头已断开，屏幕录制仍会继续；请重新连接设备后再录制'));
  constructor(readonly id: string, readonly stream: MediaStream, private api: CameraRecordingApi,
    private onFailure: (error: Error) => void = () => {}, frames?: WebcamFrames) {
    this.frames = frames ?? new WebcamFrameMonitor(stream, {
      onStall: stalledMs => void this.reportFrameStall(stalledMs),
      onResume: () => void this.reportFrameResumed(),
    });
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', this.ended);
    if (stream.getVideoTracks().some(track => track.readyState !== 'live')) queueMicrotask(this.ended);
  }

  private fail(reason: unknown) {
    if (this.failure || this.canceled || this.stopRequested) return;
    this.failure = reason instanceof Error ? reason : new Error(String(reason));
    this.onFailure(this.failure);
    void this.cancel().catch(() => undefined);
  }

  async ready() {
    if (this.failure) throw this.failure;
    if (this.canceled) throw new Error('摄像头会话已取消');
    await this.frames.ready();
    if (this.failure) throw this.failure;
    if (this.canceled) throw new Error('摄像头会话已取消');
  }

  /**
   * The recorder keeps producing byte chunks, and forces one every second through requestData(),
   * even after the encoder has stopped emitting frames. The main process byte-level health check
   * therefore cannot see this failure. Report frame liveness separately so a stalled camera is
   * visible while recording instead of only in the coverage warning after the stop.
   */
  private async reportFrameStall(stalledMs: number) {
    if (this.canceled || this.stopRequested || this.failure) return;
    await this.api.cameraFrameStall(this.id, stalledMs / 1000).catch(() => undefined);
  }

  private async reportFrameResumed() {
    if (this.canceled || this.stopRequested) return;
    await this.api.cameraFrameResumed(this.id).catch(() => undefined);
  }

  async start() {
    if (this.failure) throw this.failure;
    if (this.canceled) throw new Error('摄像头会话已取消');
    if (this.recorder) throw new Error('摄像头已经开始录制');
    if (!this.stream.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('摄像头已断开，请重新连接设备');
    await this.ready();
    if (this.canceled) throw this.failure ?? new Error('摄像头会话已取消');
    if (this.failure) throw this.failure;
    const settings = this.stream.getVideoTracks()[0].getSettings();
    const options = cameraRecorderOptions(settings);
    let accept!: () => void, rejectAcknowledgement!: (error: Error) => void;
    this.acknowledged = new Promise<void>((resolve, reject) => { accept = resolve; rejectAcknowledgement = reject; });
    this.rejectAcknowledgement = rejectAcknowledgement;
    const bind = (recorder: MediaRecorder) => {
      this.recorder = recorder;
      recorder.addEventListener('dataavailable', event => {
        if (this.recorder !== recorder || !event.data.size || this.canceled) return;
        this.writes = this.writes.then(async () => {
          await this.acknowledged;
          // MP4 may buffer several seconds despite the timeslice. Bound each IPC allocation/write.
          const chunkSize = 8 * 1024 * 1024;
          for (let offset = 0; offset < event.data.size && !this.canceled; offset += chunkSize) {
            const bytes = await event.data.slice(offset, offset + chunkSize).arrayBuffer();
            if (!this.canceled) await this.api.cameraAppend(this.id, bytes);
          }
        }).catch(error => {
          // Final flush errors must also make finish fail, even after a deliberate stop.
          if (this.stopRequested && !this.canceled) this.failure = error instanceof Error ? error : new Error(String(error));
          else this.fail(error);
        });
      });
      recorder.addEventListener('error', () => {
        if (this.recorder === recorder) this.fail(new Error('摄像头录制中断，屏幕录制仍会继续；请检查设备连接'));
      });
      recorder.addEventListener('stop', () => {
        if (this.recorder === recorder && !this.stopRequested && !this.canceled) this.fail(new Error('摄像头录制意外结束，屏幕录制仍会继续'));
      });
      recorder.addEventListener('start', () => {
        if (this.recorder !== recorder) return;
        if (this.canceled) { rejectAcknowledgement(this.failure ?? new Error('摄像头会话已取消')); return; }
        this.frames.watch();
        this.startFlushTimer(recorder);
        // The first encoded blob may arrive much later; its buffering must not shift the capture clock.
        const startedAt = Date.now();
        void Promise.resolve().then(() => {
          if (!recorder.mimeType) throw new Error('摄像头未确认输出编码格式');
          const actual = cameraContainer(recorder.mimeType);
          return this.api.cameraStarted(this.id, startedAt, actual.mimeType);
        }).then(accept, rejectAcknowledgement);
      }, { once: true });
      recorder.addEventListener('error', () => {
        if (this.recorder === recorder) rejectAcknowledgement(this.failure ?? new Error('摄像头启动失败'));
      }, { once: true });
    };
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => rejectAcknowledgement(new Error('摄像头启动超时')), 8000);
      void this.acknowledged.then(() => { clearTimeout(timer); resolve(); }, error => {
        clearTimeout(timer); this.fail(error); reject(error);
      });
      try { startCameraMediaRecorder(this.stream, options, bind); }
      catch (error) { rejectAcknowledgement(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  /**
   * MP4/WebM timeslices are only hints. Explicitly request a bounded flush so a
   * healthy source cannot sit in the encoder without producing IPC data for minutes.
   */
  private startFlushTimer(recorder: MediaRecorder) {
    if (typeof recorder.requestData !== 'function') return;
    this.clearFlushTimer();
    this.flushTimer = setInterval(() => {
      if (this.recorder !== recorder || this.canceled || this.stopRequested || recorder.state !== 'recording') return;
      try { recorder.requestData(); }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    }, 1000);
    this.flushTimer.unref?.();
  }

  private clearFlushTimer() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = undefined;
  }

  private stopRecorder(): Promise<void> {
    this.stopRequested = true;
    this.clearFlushTimer();
    if (!this.recorder || this.recorder.state === 'inactive') return Promise.resolve();
    const recorder = this.recorder;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('摄像头保存超时')), 8000);
      recorder.addEventListener('stop', () => { clearTimeout(timer); resolve(); }, { once: true });
      try { recorder.stop(); } catch (error) { clearTimeout(timer); reject(error); }
    });
  }

  finish() {
    if (!this.finishing) this.finishing = this.finishOnce();
    return this.finishing;
  }

  private async finishOnce() {
    try {
      if (this.canceled) throw this.failure ?? new Error('摄像头录制已取消');
      await this.stopRecorder();
      await this.writes;
      if (this.failure) throw this.failure;
      await this.api.cameraFinish(this.id);
    } finally { this.release(); }
  }

  cancel(notify = true) {
    if (!this.canceling) this.canceling = this.cancelOnce(notify);
    return this.canceling;
  }
  private async cancelOnce(notify: boolean) {
    this.canceled = true;
    this.rejectAcknowledgement?.(this.failure ?? new Error('摄像头会话已取消'));
    const stopped = this.stopRecorder();
    this.release();
    await stopped.catch(() => undefined);
    await this.writes;
    if (notify) await this.api.cameraCancel(this.id).catch(() => undefined);
  }

  private release() {
    this.clearFlushTimer();
    this.frames.dispose();
    for (const track of this.stream.getVideoTracks()) track.removeEventListener('ended', this.ended);
    this.stream.getTracks().forEach(track => track.stop());
  }
}
