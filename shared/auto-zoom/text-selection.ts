import type { CursorSample } from '../types';

export interface SelectionActivity {
  t: number;
  kind: 'selection';
  selectionId: string;
  focus: { x: number; y: number };
  scale: number;
}

/** Geometric I-beam drag heuristic. Never reads selected text or invokes an input hook. */
export class TextSelectionTracker {
  private down = false;
  private lastTime = -1;
  private emittedAt = -1;
  private drag?: { start: CursorSample; left: number; right: number; top: number; bottom: number; active: boolean };

  reset(): void { this.down = false; this.drag = undefined; this.lastTime = -1; this.emittedAt = -1; }

  read(sample: CursorSample): SelectionActivity | undefined {
    // Click packets have receipt-time geometry, not a sampled button state.
    if (sample.click) return;
    if (!Number.isFinite(sample.t) || sample.t < 0 || sample.t <= this.lastTime) return;
    const gap = this.lastTime >= 0 && sample.t - this.lastTime > .35;
    this.lastTime = sample.t;
    const valid = sample.visible && [sample.x, sample.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1);
    const wasDown = this.down;
    this.down = sample.primaryDown === true;
    if (gap || !valid || typeof sample.primaryDown !== 'boolean') { this.drag = undefined; return; }
    if (this.down && !wasDown) {
      this.drag = sample.shape === 'ibeam'
        ? { start: sample, left: sample.x, right: sample.x, top: sample.y, bottom: sample.y, active: false }
        : undefined;
    }
    const drag = this.drag;
    if (!drag) return;
    // A changed pointer usually indicates leaving text for a scrollbar, window edge or draggable object.
    if (this.down && sample.shape !== 'ibeam') { this.drag = undefined; return; }
    if (this.down) {
      drag.left = Math.min(drag.left, sample.x); drag.right = Math.max(drag.right, sample.x);
      drag.top = Math.min(drag.top, sample.y); drag.bottom = Math.max(drag.bottom, sample.y);
      drag.active ||= sample.t - drag.start.t >= .12
        && Math.hypot(drag.right - drag.left, drag.bottom - drag.top) >= .006;
    }
    if (!this.down) this.drag = undefined;
    if (!drag.active || (this.down && sample.t - this.emittedAt < .1)) return;
    this.emittedAt = sample.t;
    return { t: sample.t, kind: 'selection', selectionId: `selection-${Math.round(drag.start.t * 1000)}`,
      focus: { x: (drag.left + drag.right) / 2, y: (drag.top + drag.bottom) / 2 },
      scale: Math.max(1, Math.min(1.7, 1 / (drag.right - drag.left + .16), 1 / (drag.bottom - drag.top + .16))) };
  }
}

export function selectionActivities(cursor: CursorSample[], duration: number): SelectionActivity[] {
  const tracker = new TextSelectionTracker();
  return cursor.filter(sample => Number.isFinite(sample.t) && sample.t >= 0 && sample.t < duration)
    .sort((a, b) => a.t - b.t).flatMap(sample => {
      const event = tracker.read(sample);
      return event ? [event] : [];
    });
}
