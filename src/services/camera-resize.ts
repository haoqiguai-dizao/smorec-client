export const CAMERA_SIZE_MIN = .12;
export const CAMERA_SIZE_MAX = .42;
export type CameraResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
export interface CameraResizeStart {
  edge: CameraResizeEdge;
  size: number;
  width: number;
  height: number;
  screenX: number;
  screenY: number;
}

/** Screen-coordinate deltas remain stable while the native camera window changes origin. */
export function cameraResizeSize(start: CameraResizeStart, screenX: number, screenY: number): number {
  const width = Math.max(1, start.width - 12), height = Math.max(1, start.height - 12);
  const horizontal = start.edge.includes('e') ? 1 : start.edge.includes('w') ? -1 : 0;
  const vertical = start.edge.includes('s') ? 1 : start.edge.includes('n') ? -1 : 0;
  const dx = screenX - start.screenX, dy = screenY - start.screenY;
  // Project corner movement onto the fixed-aspect diagonal; resize around the saved camera center.
  const growth = horizontal && vertical
    ? (dx * horizontal * width + dy * vertical * height) / (width * width + height * height)
    : horizontal ? dx * horizontal / width : dy * vertical / height;
  const size = start.size * (1 + 2 * growth);
  return Math.round(Math.max(CAMERA_SIZE_MIN, Math.min(CAMERA_SIZE_MAX, Number.isFinite(size) ? size : start.size)) * 1000) / 1000;
}

/** Coalesces only unsent values. Final pointer-up values cannot be overtaken by old IPC requests. */
export class CameraSizeDispatcher {
  private pending?: number;
  private sending = false;
  private stopped = false;
  constructor(private send: (size: number) => Promise<void>) {}
  update(size: number): void { if (!this.stopped) { this.pending = size; void this.flush(); } }
  discardPending(): void { this.pending = undefined; }
  stop(): void { this.stopped = true; this.pending = undefined; }
  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      while (!this.stopped && this.pending !== undefined) {
        const value = this.pending; this.pending = undefined;
        await this.send(value);
      }
    } catch { this.stop(); }
    finally { this.sending = false; }
  }
}
