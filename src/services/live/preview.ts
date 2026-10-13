const PREVIEW_FPS = 10;
const PREVIEW_MAX_EDGE = 640;

/** A bounded display copy; the full composition stays off the document. */
export class LivePreview {
  readonly canvas = document.createElement('canvas');
  private context: CanvasRenderingContext2D;
  private enabled = true;
  private visible = true;
  private lastDraw = -Infinity;
  constructor(width: number, height: number) {
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height));
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    this.context = this.canvas.getContext('2d', { alpha: false })!;
  }
  setEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) this.lastDraw = -Infinity;
    this.enabled = enabled;
  }
  setVisible(visible: boolean): void {
    if (this.visible !== visible) this.lastDraw = -Infinity;
    this.visible = visible;
  }
  present(source: HTMLCanvasElement, now: number): boolean {
    if (!this.enabled || !this.visible || document.hidden || now - this.lastDraw < 1000 / PREVIEW_FPS) return false;
    this.context.drawImage(source, 0, 0, this.canvas.width, this.canvas.height);
    this.lastDraw = now;
    return true;
  }
  dispose(): void { this.canvas.remove(); this.canvas.width = 0; this.canvas.height = 0; }
}
