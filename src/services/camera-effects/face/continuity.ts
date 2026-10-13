import type { Point } from './geometry';

const HOLD_MS = 240;
const EXPIRE_MS = 480;
const MAX_RESULT_AGE_MS = 360;
const RETURN_MS = 120;

/** Preview-only continuity. Never carries a face across a source change, seek, or long gap. */
export class FaceContinuity {
  private token?: unknown;
  private time?: number;
  private lastRead?: number;
  private latest?: { points: Point[]; time: number; finished: number; lag: number };
  private seen = false;
  generation = 0;
  strength = 0;
  geometryStrength = 0;

  frame(token: unknown, time: number): void {
    if (this.token !== token || this.time === undefined || time < this.time || time - this.time > .5) {
      this.reset(); this.token = token;
    }
    this.time = time;
  }

  accept(points: Point[], time: number, generation: number, now: number): void {
    if (generation !== this.generation || this.time === undefined || time > this.time
      || (this.time - time) * 1000 > MAX_RESULT_AGE_MS) return;
    // A single missed detection is not a command to abruptly remove whitening.
    if (!points.length || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return;
    this.latest = { points, time, finished: now, lag: (this.time - time) * 1000 };
    if (!this.seen) { this.strength = 1; this.seen = true; }
  }

  read(now: number): Point[] {
    const elapsed = this.lastRead === undefined ? 0 : Math.max(0, now - this.lastRead);
    this.lastRead = now;
    const latest = this.latest;
    if (!latest || this.time === undefined) { this.strength = this.geometryStrength = 0; return []; }
    // A paused exact frame may keep its exact result. Advancing frames have a bounded lease.
    const mediaAge = (this.time - latest.time) * 1000;
    // Inference latency is not a detection dropout. Starting the lease at the input timestamp
    // makes even healthy asynchronous replies pulse once per inference cycle.
    const age = this.time === latest.time ? 0 : Math.max(mediaAge - latest.lag, now - latest.finished);
    const progress = Math.max(0, Math.min(1, (age - HOLD_MS) / (EXPIRE_MS - HOLD_MS)));
    const target = 1 - progress * progress * (3 - 2 * progress);
    this.strength = Math.min(target, this.strength + elapsed / RETURN_MS);
    // Color can bridge a brief miss; stale landmarks must not keep warping a moving face.
    this.geometryStrength = this.strength * Math.max(0, Math.min(1, (360 - mediaAge) / 200));
    return this.strength > 0 ? latest.points : [];
  }

  reset(): void {
    this.generation++; this.latest = undefined; this.time = undefined; this.lastRead = undefined;
    this.strength = this.geometryStrength = 0; this.seen = false;
  }
}
