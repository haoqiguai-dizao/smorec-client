import type { BrowserWindow, Rectangle } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { CAMERA_BOARD_DURATION } from '../../../shared/whiteboard/camera-scene';
import type { BoardBackdrop, BoardCameraTransition, BoardPresentation } from '../../../shared/whiteboard/types';
import { applyBoardCapturePolicy } from './capture-policy';
import { clampBoard } from './geometry';
import type { BoardCameraPreview } from './camera-preview';

interface Host {
  window?: BrowserWindow; area?: Rectangle; usableArea?: Rectangle;
  session: string; visible: boolean; available: boolean; disposed: boolean; presentation: BoardPresentation;
  setBounds(bounds: Rectangle): void;
  setPresentation(value: BoardPresentation): void;
  sync(value: BoardPresentation, visible: boolean): Promise<void>;
  append(): Promise<void>;
  publish(): void;
  failed(error: unknown): void;
}

/** Owns the entire camera transition and the original window's recovery point. */
export class BoardCameraMode {
  backdrop: BoardBackdrop = 'white';
  shade = .4;
  busy = false;
  transition?: BoardCameraTransition & { startedAt: number };
  private generation = 0;
  private restorePoint?: { bounds: Rectangle; presentation: BoardPresentation };
  constructor(private host: () => Host, private camera: BoardCameraPreview) {}

  cancel() { this.generation++; this.transition = undefined; this.busy = false; }

  async restore(): Promise<void> {
    const host = this.host(), point = this.restorePoint;
    this.cancel();
    if (point && host.window && host.usableArea) {
      const before = { bounds: host.window.getBounds(), presentation: host.presentation };
      try {
        host.setBounds(clampBoard(point.bounds, host.usableArea));
        host.setPresentation(point.presentation);
        host.window.setResizable(true);
        applyBoardCapturePolicy(host.window, point.presentation);
        await host.sync(point.presentation, host.visible);
      } catch (error) {
        // Retain the recovery point and a usable return button for a retry.
        host.setBounds(before.bounds); host.setPresentation(before.presentation); host.window.setResizable(false);
        applyBoardCapturePolicy(host.window, before.presentation);
        this.backdrop = 'camera'; this.camera.cover(host.visible);
        await host.sync(before.presentation, host.visible).catch(host.failed);
        host.publish(); throw error;
      }
    }
    this.backdrop = 'white'; this.camera.cover(false);
    this.restorePoint = undefined;
    host.publish();
  }

  async configure(value: unknown, shade: unknown, reveal?: () => Promise<void>): Promise<void> {
    if (value !== 'white' && value !== 'camera' || shade !== undefined && (typeof shade !== 'number' || !Number.isFinite(shade) || shade < .15 || shade > .75))
      throw new Error('白板背景设置无效');
    const host = this.host(), window = host.window, area = host.area;
    if (!window || !area) throw new Error('白板正在准备');
    // Returning must remain usable even while the entry animation or IPC is pending.
    if (value === 'white' && this.busy) { await this.restore(); await host.append(); return; }
    if (this.busy) throw new Error('白板模式正在切换');
    if (value === 'camera' && !this.camera.available()) throw new Error('请先开启并连接摄像头');
    if (typeof shade === 'number') this.shade = shade;
    if (value === this.backdrop) { await host.append(); host.publish(); return; }
    const generation = ++this.generation;
    const previous = { backdrop: this.backdrop, bounds: window.getBounds(), presentation: host.presentation, restore: this.restorePoint };
    const current = () => { const next = this.host(); return !next.disposed && generation === this.generation && host.session === next.session; };
    const bounds = this.camera.bounds;
    const camera = reveal ? { x: 0, y: 0, width: 1, height: 1 } : bounds ? {
      x: Math.max(0, Math.min(.95, (bounds.x - area.x) / area.width)),
      y: Math.max(0, Math.min(.95, (bounds.y - area.y) / area.height)),
      width: Math.min(1, bounds.width / area.width), height: Math.min(1, bounds.height / area.height),
    } : { x: .7, y: .7, width: .25, height: .25 };
    camera.width = Math.max(.001, Math.min(camera.width, 1 - camera.x));
    camera.height = Math.max(.001, Math.min(camera.height, 1 - camera.y));
    this.busy = true;
    this.transition = { direction: value === 'camera' ? 'enter' : 'exit', duration: CAMERA_BOARD_DURATION, camera, startedAt: Date.now() / 1000 };
    try {
      if (value === 'camera') {
        this.restorePoint = { bounds: window.getBounds(), presentation: host.presentation };
        await host.sync('canvas', false);
        if (!current() || (!this.host().visible && !reveal) || !this.host().available) return;
        host.setPresentation('canvas'); host.setBounds(area);
        applyBoardCapturePolicy(window, 'canvas');
      }
      this.backdrop = value; this.camera.cover(true); window.setResizable(false);
      // Hidden entry starts full-screen; defer its shade animation until the first camera paint.
      this.transition.startedAt = Date.now() / 1000 + (reveal ? 8.1 : 0);
      if (reveal) await reveal();
      await host.append(); host.publish();
      await delay(CAMERA_BOARD_DURATION * 1000);
      if (!current()) return;
      this.transition = undefined;
      if (value === 'white') await this.restore();
      await host.append();
    } catch (error) {
      if (current()) {
        this.backdrop = previous.backdrop; host.setPresentation(previous.presentation);
        this.transition = undefined; this.restorePoint = previous.restore;
        host.setBounds(previous.bounds); window.setResizable(previous.backdrop !== 'camera');
        applyBoardCapturePolicy(window, previous.presentation);
        this.camera.cover(this.host().visible && previous.backdrop === 'camera');
        await host.sync(previous.presentation, this.host().visible).catch(host.failed);
      }
      throw error;
    } finally { if (generation === this.generation) { this.busy = false; host.publish(); } }
  }
}
