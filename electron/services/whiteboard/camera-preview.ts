import { randomUUID } from 'node:crypto';
import type { BrowserWindow, Rectangle } from 'electron';
import type { CameraPreviewMessage, LiveRecordingState } from '../../../shared/types';
import { parsePreviewSignal } from '../recording-overlay/validation';
import { diagnostic } from '../diagnostics';

export interface BoardCameraPorts {
  request(session: string): unknown; signal(message: CameraPreviewMessage): unknown; covered(value: boolean): void;
}
/** A separate viewer lease reuses the prepared camera; it never opens another device. */
export class BoardCameraPreview {
  state?: LiveRecordingState;
  bounds?: Rectangle;
  private lease?: string;
  private retired = new Set<string>();
  constructor(private window: () => BrowserWindow | undefined, private ports?: BoardCameraPorts) {}
  update(state: LiveRecordingState, bounds?: Rectangle) {
    if (state.cameraSessionId !== this.state?.cameraSessionId || !state.cameraAvailable) this.close();
    this.state = state; this.bounds = bounds;
  }
  available() { return !!this.ports && !!this.state?.cameraAvailable && !!this.state.cameraVisible; }
  ready() {
    if (!this.available()) throw new Error('请先开启并连接摄像头');
    this.close();
    const sessionId = randomUUID(); this.lease = sessionId;
    setImmediate(() => {
      if (this.lease === sessionId) void Promise.resolve(this.ports!.request(sessionId))
        .catch(error => diagnostic('whiteboard.camera-preview', error));
    });
    return { sessionId };
  }
  signal(value: unknown, visible = true) {
    const id = value && typeof value === 'object' && 'sessionId' in value && typeof value.sessionId === 'string' ? value.sessionId : '';
    const retired = this.retired.has(id);
    const message = parsePreviewSignal(value, retired ? id : this.lease ?? '', 'camera');
    if (message.signal.type === 'close') { if (!retired) this.close(); return; }
    if (retired || !visible) throw new Error('白板摄像头会话已失效');
    return this.ports?.signal(message);
  }
  receive(value: CameraPreviewMessage): boolean {
    if (this.retired.has(value.sessionId)) return true;
    if (!this.lease || value.sessionId !== this.lease) return false;
    const message = parsePreviewSignal(value, this.lease, 'host');
    const window = this.window();
    if (window && !window.isDestroyed()) window.webContents.send('whiteboard:camera-preview-incoming', message);
    return true;
  }
  cover(value: boolean) { this.ports?.covered(value); }
  close() {
    const sessionId = this.lease; this.lease = undefined;
    if (sessionId) {
      this.retired.add(sessionId);
      if (this.retired.size > 8) this.retired.delete(this.retired.values().next().value!);
      void Promise.resolve().then(() => this.ports?.signal({ sessionId, signal: { type: 'close' } }))
        .catch(error => diagnostic('whiteboard.camera-close', error));
    }
  }
}
