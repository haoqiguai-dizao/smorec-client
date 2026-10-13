import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { OverlayRole } from './validation';

interface Ports {
  disposed(): boolean;
  role(event: IpcMainInvokeEvent): OverlayRole;
  snapshot(): unknown;
  control(value: unknown): Promise<void>;
  expanded(value: boolean): void;
  cameraSettings(value: boolean): void;
  previewReady(role: OverlayRole): unknown;
  previewSignal(role: OverlayRole, value: unknown): unknown;
}

/** Own the overlay IPC registration and disposal; resolve the current window for every request. */
export function installRecordingOverlayIpc(ports: Ports): () => void {
  const channels: string[] = [];
  const handle = (name: string, count: number, callback: (role: OverlayRole, value?: unknown) => unknown) => {
    const channel = 'recording-overlay:' + name;
    channels.push(channel);
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (ports.disposed()) throw new Error('录制浮窗已经关闭');
      const role = ports.role(event);
      if (args.length !== count) throw new Error('录制控制参数无效');
      return callback(role, args[0]);
    });
  };
  handle('get-state', 0, () => ports.snapshot());
  handle('control', 1, (_role, value) => ports.control(value));
  handle('expanded', 1, (role, value) => {
    if (role !== 'toolbar' || typeof value !== 'boolean') throw new Error('只有操作条可以调整设置面板');
    ports.expanded(value);
  });
  handle('camera-settings', 1, (_role, value) => {
    if (typeof value !== 'boolean') throw new Error('画面设置状态无效');
    ports.cameraSettings(value);
  });
  handle('preview-ready', 0, role => ports.previewReady(role));
  handle('preview-signal', 1, (role, value) => ports.previewSignal(role, value));
  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}
