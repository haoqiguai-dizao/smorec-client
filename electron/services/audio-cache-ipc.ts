import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { audioCacheManager } from './audio-cache';
export function installAudioCacheIpc(trusted: (event: IpcMainInvokeEvent) => boolean): void {
  for (const action of ['state', 'clear'] as const) ipcMain.handle(`audio-cache:${action}`, event => {
    if (!trusted(event)) throw new Error('请求来源不受信任');
    return audioCacheManager()[action]();
  });
}
