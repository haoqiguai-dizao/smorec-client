import type { LiveInput } from './live-types';
import { clamp } from './timeline';
import { TextSelectionTracker } from './auto-zoom/text-selection';
import type { CursorSample } from './types';

interface Camera { x: number; y: number; scale: number }
interface Point { x: number; y: number }
interface CameraEvent { t: number; order: number; kind: 'reset' | 'click' | 'typing' | 'cursor'; point?: Point; cursor?: CursorSample }
const full = (): Camera => ({ x: .5, y: .5, scale: 1 });
const validPoint = (p: Point): boolean => [p.x, p.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1);
const compare = (a: CameraEvent, b: CameraEvent): number => a.t - b.t || a.order - b.order;

/** A source-clock camera. Rendering advances motion even when the captured pixels do not change. */
export class LiveZoom {
  private automatic = true;
  private current = full();
  private target = full();
  private anchor?: Point;
  private expires = 0;
  private lastTime = 0;
  private watermark = { t: -1, order: -1 };
  private pending: CameraEvent[] = [];
  private selection = new TextSelectionTracker();
  private selectionExpires = 0;

  get enabled(): boolean { return this.automatic; }
  set enabled(value: boolean) {
    if (value === this.automatic) return;
    this.automatic = value;
    this.reset();
  }

  reset(): void {
    this.clear();
    this.pending = [];
    // A manual full-view action must not replay input waiting in the transport.
    this.watermark = { t: Math.max(this.watermark.t, this.lastTime), order: 3 };
  }
  toggle(): void { this.enabled = !this.enabled; }

  ingest(events: LiveInput[]): void {
    const incoming: CameraEvent[] = [];
    for (const event of events) {
      if (event.cursor?.click) {
        const cursor = event.cursor;
        incoming.push({ t: cursor.t, order: 1, kind: 'click',
          ...(cursor.visible && validPoint(cursor) ? { point: { x: cursor.x, y: cursor.y } } : {}) });
      }
      else if (event.cursor && typeof event.cursor.primaryDown === 'boolean') {
        incoming.push({ t: event.cursor.t, order: 3, kind: 'cursor', cursor: event.cursor });
      }
      if (event.activity?.kind === 'reset') incoming.push({ t: event.activity.t, order: 0, kind: 'reset' });
      else if (event.activity?.kind === 'typing') {
        const focus = event.activity.focus;
        incoming.push({ t: event.activity.t, order: 2, kind: 'typing',
          ...(focus && validPoint(focus) ? { point: { ...focus } } : {}) });
      }
    }
    const usable = incoming.filter(event => Number.isFinite(event.t) && event.t >= 0);
    if (!this.enabled) {
      for (const event of usable) if (this.newer(event)) this.watermark = { t: event.t, order: event.order };
      return;
    }
    this.pending.push(...usable);
    if (this.pending.length > 512) { this.reset(); return; }
    this.pending.sort(compare);
  }

  at(time: number): Camera {
    if (!Number.isFinite(time) || time < this.lastTime) return { ...this.current };
    let consumed = 0;
    for (const event of this.pending) {
      if (event.t > time) break;
      consumed++;
      // The native click reset can arrive in a later batch with the click's exact timestamp.
      // Its lower precedence cannot clear a newer click or typing anchor.
      if (!this.newer(event)) continue;
      this.advance(Math.max(this.lastTime, event.t));
      if (event.kind !== 'cursor') this.watermark = { t: event.t, order: event.order };
      this.apply(event);
    }
    if (consumed) this.pending.splice(0, consumed);
    this.advance(time);
    return { ...this.current };
  }

  private newer(event: CameraEvent): boolean {
    return event.t > this.watermark.t || event.t === this.watermark.t && event.order >= this.watermark.order;
  }
  private clear(): void {
    this.anchor = undefined; this.target = full(); this.expires = 0; this.selectionExpires = 0; this.selection.reset();
  }
  private apply(event: CameraEvent): void {
    if (event.kind === 'cursor') {
      const selection = this.selection.read(event.cursor!);
      if (selection) {
        this.watermark = { t: event.t, order: event.order };
        this.anchor = selection.focus;
        this.target = { ...selection.focus, scale: selection.scale };
        this.expires = event.t + 2;
        this.selectionExpires = this.expires;
      }
      return;
    }
    if (event.kind === 'reset') {
      if (event.t < this.selectionExpires) { this.anchor = undefined; this.selection.reset(); }
      else this.clear();
      return;
    }
    if (event.kind === 'click') {
      if (!event.point) { this.clear(); return; }
      this.selectionExpires = 0;
      this.anchor = event.point;
      this.target = { ...this.anchor, scale: 1.7 };
      this.expires = event.t + 1.65;
      return;
    }
    const point = event.point;
    // Small caret advances keep the frame steady; a different editor moves the camera.
    if (point && (!this.anchor || Math.hypot(point.x - this.anchor.x, point.y - this.anchor.y) > .12)) this.anchor = point;
    if (this.anchor) { this.target = { ...this.anchor, scale: 1.7 }; this.expires = event.t + 2; this.selectionExpires = 0; }
  }

  private advance(time: number): void {
    if (this.target.scale > 1 && this.expires <= this.lastTime) this.target = full();
    if (this.target.scale > 1 && this.expires < time) {
      this.blend(this.expires - this.lastTime);
      this.lastTime = this.expires;
      this.target = full();
    }
    this.blend(time - this.lastTime);
    this.lastTime = time;
  }
  private blend(dt: number): void {
    if (dt <= 0) return;
    const blend = 1 - Math.exp(-dt / .12);
    const rawScale = this.current.scale + (this.target.scale - this.current.scale) * blend;
    const scale = Math.abs(rawScale - 1) < .001 ? 1 : rawScale;
    const margin = .5 / scale;
    this.current = { scale,
      x: clamp(this.current.x + (this.target.x - this.current.x) * blend, margin, 1 - margin),
      y: clamp(this.current.y + (this.target.y - this.current.y) * blend, margin, 1 - margin) };
  }
}
