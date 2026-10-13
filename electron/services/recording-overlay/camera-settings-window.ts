import type { Rectangle } from 'electron';
import type { CameraPanelLayout } from '../../../shared/types';
import { adjustBoundsForReadback, clampOverlayBounds } from './geometry';
import { cameraSettingsGeometry } from './camera-settings-geometry';

interface CameraWindowPort {
  bounds(): Rectangle | undefined;
  request(): Rectangle | undefined;
  setBounds(request: Rectangle, restoreTarget?: Rectangle): void;
  area(bounds: Rectangle): Rectangle;
  reserve?(bounds: Rectangle): Rectangle;
  layoutKey?(): string;
  setRegions?(regions: Rectangle[]): void;
}
interface Anchor { bounds: Rectangle; request: Rectangle }
const relative = (bounds: Rectangle, origin: Rectangle): Rectangle => ({ ...bounds, x: bounds.x - origin.x, y: bounds.y - origin.y });
const contains = (outer: Rectangle, inner: Rectangle): boolean => inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const same = (a: Rectangle, b: Rectangle): boolean => (['x', 'y', 'width', 'height'] as const).every(key => a[key] === b[key]);

/** Owns only the outer HWND layout; opening controls never changes the camera composition or its stream. */
export class CameraSettingsWindow {
  private anchor?: Anchor;
  private observed?: Rectangle;
  private current?: CameraPanelLayout;
  private reserved?: { bounds: Rectangle; area: Rectangle; key?: string };
  constructor(private port: CameraWindowPort) {}
  get layout(): CameraPanelLayout | undefined { return this.current; }
  get cameraBounds(): Rectangle | undefined { return this.anchor?.bounds; }
  open(): void {
    if (this.anchor) return;
    const bounds = this.port.bounds();
    if (!bounds) throw new Error('摄像头浮窗尚未就绪');
    const anchor = { bounds, request: this.port.request() ?? bounds };
    this.render(anchor);
  }
  close(): void {
    const anchor = this.anchor;
    if (!anchor) return;
    this.clear();
    const target = clampOverlayBounds(anchor.bounds, this.port.area(anchor.bounds));
    this.port.setBounds(adjustBoundsForReadback(anchor.request, anchor.bounds, target), target);
  }
  resize(bounds: Rectangle, restoreTarget?: Rectangle): void {
    if (!this.anchor) { this.port.setBounds(bounds, restoreTarget); return; }
    const anchor = { bounds: restoreTarget ?? bounds, request: bounds };
    const reserved = this.reserved;
    if (reserved && this.observed && this.current && contains(reserved.bounds, anchor.bounds)
      && same(reserved.area, this.port.area(anchor.bounds)) && reserved.key === this.port.layoutKey?.()) {
      this.anchor = anchor;
      this.current = { ...this.current, camera: relative(anchor.bounds, this.observed) };
      this.updateRegions();
      return;
    }
    try { this.render(anchor); }
    catch {
      // A deliberate resize/display change may leave no adjacent room. Keep the new camera size and close controls.
      this.clear();
      this.port.setBounds(bounds, restoreTarget);
    }
  }
  moved(outer: Rectangle): Rectangle {
    if (!this.anchor || !this.observed) return outer;
    const previous = this.anchor;
    const shifted = { ...previous.bounds, x: previous.bounds.x + outer.x - this.observed.x,
      y: previous.bounds.y + outer.y - this.observed.y };
    const bounds = clampOverlayBounds(shifted, this.port.area(shifted));
    const request = adjustBoundsForReadback(previous.request, previous.bounds, bounds);
    this.render({ request, bounds });
    return bounds;
  }
  private render(anchor: Anchor): void {
    const area = this.port.area(anchor.bounds);
    const reserved = this.port.reserve?.(anchor.bounds) ?? anchor.bounds;
    const geometry = cameraSettingsGeometry(reserved, area);
    this.port.setBounds(geometry.bounds);
    const observed = this.port.bounds() ?? geometry.bounds;
    // Read back the quantized HWND origin; relative CSS offsets compensate without moving the image one DIP.
    this.anchor = anchor; this.observed = observed;
    this.reserved = { bounds: reserved, area, key: this.port.layoutKey?.() };
    this.current = { camera: relative(anchor.bounds, observed), settings: relative(geometry.settings, observed) };
    this.updateRegions();
  }
  private updateRegions(): void {
    if (!this.current || !this.observed) return;
    const outer = this.observed;
    const regions = [this.current.camera, this.current.settings].map(rectangle => {
      const gutter = rectangle === this.current!.settings ? 6 : 0;
      const x = Math.max(0, Math.floor(rectangle.x - gutter)), y = Math.max(0, Math.floor(rectangle.y - gutter));
      return { x, y, width: Math.min(outer.width, Math.ceil(rectangle.x + rectangle.width + gutter)) - x,
        height: Math.min(outer.height, Math.ceil(rectangle.y + rectangle.height + gutter)) - y };
    });
    // The large layout reserve is not an interactive transparent window over the desktop.
    this.port.setRegions?.(regions);
  }
  private clear(): void {
    this.anchor = undefined; this.current = undefined; this.observed = undefined; this.reserved = undefined;
    this.port.setRegions?.([]);
  }
}
