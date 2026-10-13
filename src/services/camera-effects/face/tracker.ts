import { context2d, makeCanvas, resizeCanvas, sourceSize } from '../canvas';
import type { Point } from './geometry';
import { FaceContinuity } from './continuity';

export const FACE_READY_EVENT = 'camera-face-ready';
export const FACE_STATUS_EVENT = 'camera-face-status';
let resultRevision = 0;
export const faceResultRevision = () => resultRevision;
export type FaceStatus = 'idle' | 'loading' | 'tracking' | 'no-face' | 'error';
const trackers = new Set<FaceTracker>();
export function currentFaceStatus(): FaceStatus {
  const statuses = [...trackers].map(tracker => tracker.status);
  return statuses.includes('error') ? 'error' : statuses.includes('tracking') ? 'tracking'
    : statuses.includes('loading') ? 'loading' : statuses.includes('no-face') ? 'no-face' : 'idle';
}
export function retryFaceTracking() { for (const tracker of trackers) tracker.retry(); }

/** One in-flight bitmap per renderer. Export awaits inference; preview never blocks the UI thread. */
export class FaceTracker {
  status: FaceStatus = 'idle';
  private worker?: Worker;
  private serial = 0;
  private pending?: { id: number; resolve: (points: Point[]) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private canvas = makeCanvas();
  private context = context2d(this.canvas);
  private continuity = new FaceContinuity();
  get previewStrength(): number { return this.continuity.strength; }
  get previewGeometryStrength(): number { return this.continuity.geometryStrength; }
  private submitted?: { token: unknown; time: number };
  private submittedAt = -Infinity;
  private busy = false;
  private detecting = false;
  private disposed = false;
  constructor() { trackers.add(this); }
  private setStatus(status: FaceStatus) {
    if (this.status === status) return;
    this.status = status; globalThis.dispatchEvent?.(new Event(FACE_STATUS_EVENT));
  }
  private connect() {
    if (this.worker) return;
    const base = new URL('beauty/', document.baseURI).href;
    this.worker = new Worker(base + 'worker.js');
    this.worker.onmessage = (event: MessageEvent<{ id: number; points?: Point[]; error?: string }>) => {
      const pending = this.pending;
      if (!pending || pending.id !== event.data.id) return;
      clearTimeout(pending.timer); this.pending = undefined;
      if (event.data.error) pending.reject(new Error('人脸美颜暂不可用：' + event.data.error));
      else pending.resolve(event.data.points ?? []);
    };
    this.worker.onerror = () => this.fail(new Error('人脸美颜运行库加载失败，请重试'));
  }
  private fail(error: Error) {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = undefined; }
    this.worker?.terminate(); this.worker = undefined;
  }
  async detect(source: CanvasImageSource, video?: { timestamp: number; generation: number }): Promise<Point[]> {
    if (this.disposed) throw new Error('人脸处理器已释放');
    if (this.detecting) throw new Error('人脸处理器正在处理上一帧');
    this.detecting = true;
    let bitmap: ImageBitmap | undefined;
    try {
      this.connect(); if (this.status === 'idle' || this.status === 'error') this.setStatus('loading');
      const size = sourceSize(source), scale = Math.min(1, 640 / Math.max(size.width, size.height));
      resizeCanvas(this.canvas, Math.max(1, Math.round(size.width * scale)), Math.max(1, Math.round(size.height * scale)));
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.context.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
      bitmap = await createImageBitmap(this.canvas);
      if (this.disposed) throw new Error('人脸处理器已释放');
      const points = await new Promise<Point[]>((resolve, reject) => {
        const id = ++this.serial;
        const timer = setTimeout(() => this.fail(new Error('人脸美颜处理超时，请重试')), 20000);
        this.pending = { id, resolve, reject, timer };
        this.worker!.postMessage({ id, bitmap, video, base: new URL('beauty/', document.baseURI).href }, [bitmap!]);
        bitmap = undefined; // Worker owns and closes the transferred bitmap.
      });
      this.setStatus(points.length ? 'tracking' : 'no-face'); return points;
    } catch (error) {
      bitmap?.close(); this.fail(error instanceof Error ? error : new Error('人脸美颜处理失败'));
      if (!this.disposed) this.setStatus('error');
      throw error;
    } finally { this.detecting = false; }
  }
  preview(source: CanvasImageSource, token: unknown, time: number): Point[] {
    const before = this.continuity.generation;
    this.continuity.frame(token, time);
    if (before !== this.continuity.generation) { this.submitted = undefined; this.submittedAt = -Infinity; }
    if (!this.busy && this.status !== 'error' && performance.now() - this.submittedAt >= 1000 / 15
      && (!this.submitted || this.submitted.token !== token || this.submitted.time !== time)) {
      this.busy = true; this.submitted = { token, time };
      this.submittedAt = performance.now();
      const generation = this.continuity.generation;
      void this.detect(source, { timestamp: time * 1000, generation }).then(points => {
        if (!this.disposed) this.continuity.accept(points, time, generation, performance.now());
      }).catch(() => { /* Existing face fades out under the same bounded lease. */ }).finally(() => {
        this.busy = false;
        if (!this.disposed) { resultRevision++; globalThis.dispatchEvent?.(new Event(FACE_READY_EVENT)); }
      });
    }
    return this.continuity.read(performance.now());
  }
  retry() { if (this.status === 'error') { this.fail(new Error('重新加载')); this.submitted = undefined; this.submittedAt = -Infinity; this.setStatus('idle'); globalThis.dispatchEvent?.(new Event(FACE_READY_EVENT)); } }
  dispose() {
    this.disposed = true; this.fail(new Error('人脸处理器已释放')); trackers.delete(this);
    this.canvas.width = 1; this.canvas.height = 1; this.continuity.reset();
    globalThis.dispatchEvent?.(new Event(FACE_STATUS_EVENT));
  }
}
