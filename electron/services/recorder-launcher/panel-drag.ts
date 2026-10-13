import type { Point, Rectangle } from 'electron';

interface DragWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  getBounds(): Rectangle;
  setBounds(bounds: Rectangle): void;
}
/** Cursor and window positions are both main-process DIP coordinates, including mixed-DPI displays. */
export class PanelDrag {
  private start?: { window: DragWindow; bounds: Rectangle; cursor: Point };
  constructor(private cursor: () => Point, private finished: (bounds: Rectangle) => void = () => {},
    private dimensions: (bounds: Rectangle) => Pick<Rectangle, 'width' | 'height'> = bounds => bounds) {}
  handle(action: unknown, window?: DragWindow): void {
    if (typeof action !== 'string' || !['start', 'move', 'end'].includes(action)) throw new Error('窗口拖动操作无效');
    if (action === 'end') {
      if (this.start && !this.start.window.isDestroyed()) this.finished(this.start.window.getBounds());
      this.start = undefined; return;
    }
    if (!window || window.isDestroyed() || !window.isVisible()) { this.start = undefined; return; }
    const cursor = this.cursor();
    if (action === 'start') {
      const bounds = window.getBounds();
      if (cursor.x < bounds.x || cursor.y < bounds.y || cursor.x >= bounds.x + bounds.width || cursor.y >= bounds.y + bounds.height) return;
      // Use the configured DIP size when supplied, rather than repeatedly feeding
      // Windows' rounded getBounds size back into setBounds on a scaled display.
      this.start = { window, bounds: { ...bounds, ...this.dimensions(bounds) }, cursor }; return;
    }
    const start = this.start;
    if (!start || start.window !== window) return;
    window.setBounds({ ...start.bounds, x: Math.round(start.bounds.x + cursor.x - start.cursor.x), y: Math.round(start.bounds.y + cursor.y - start.cursor.y) });
  }
}
