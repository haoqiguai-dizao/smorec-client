import { mediaFrameIdentity, sameMediaFrame, type MediaFrameIdentity } from '../../media-frame-identity';
import type { Point } from './geometry';
import type { FaceTracker } from './tracker';

interface PreparedFace {
  order: number;
  source: CanvasImageSource;
  frame?: MediaFrameIdentity;
  points?: Point[];
  ready: Promise<void>;
}

/** One IMAGE-mode model; bounded callers retain current + three future frames. */
export class FacePreparation {
  private entries: PreparedFace[] = [];
  private worker?: { tracker: FaceTracker; tail: Promise<void> };
  private disposed = false;
  private sequence = 0;
  constructor(private create: () => FaceTracker) {}
  prepare(source: CanvasImageSource, order = this.sequence++): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('人脸处理器已释放'));
    const frame = mediaFrameIdentity(source);
    const existing = this.entries.find(item => sameMediaFrame(item.frame, frame));
    if (existing) { existing.order = Math.max(existing.order, order); return existing.ready; }
    const worker = this.worker ??= { tracker: this.create(), tail: Promise.resolve() };
    const entry: PreparedFace = { source, frame, order, ready: Promise.resolve() };
    // Sparse tracks may finish decoding out of order. Retain by output order, not arrival order.
    this.entries = [...this.entries, entry].sort((a, b) => a.order - b.order).slice(-4);
    entry.ready = worker.tail.then(async () => {
      if (this.disposed) throw new Error('人脸处理器已释放');
      const points = await worker.tracker.detect(source);
      if (!this.disposed) entry.points = points;
    });
    worker.tail = entry.ready.catch(() => undefined);
    return entry.ready;
  }
  points(source: CanvasImageSource): Point[] | undefined {
    const frame = mediaFrameIdentity(source);
    return this.entries.findLast(item => frame ? sameMediaFrame(item.frame, frame) : !item.frame && item.source === source)?.points;
  }
  consumeUnstamped(source: CanvasImageSource): void {
    this.entries = this.entries.filter(item => item.frame || item.source !== source);
  }
  dispose(): void {
    this.disposed = true; this.entries = [];
    this.worker?.tracker.dispose(); this.worker = undefined;
  }
}
