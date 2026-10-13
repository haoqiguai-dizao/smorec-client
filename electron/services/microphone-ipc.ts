import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { MicrophoneSession } from './microphone-session';
import { trustedRecorderSender } from './recorder-launcher/validation';

interface Owners {
  editor: () => BrowserWindow | undefined;
  recorder: () => BrowserWindow | undefined;
  idle: () => boolean;
  trustedEditor: (event: IpcMainInvokeEvent) => boolean;
}
export function installMicrophoneIpc(session: MicrophoneSession, owners: Owners): void {
  const handle = (channel: string, recorder: boolean, handler: (...args: unknown[]) => unknown, cleanup = false) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      const owner = recorder ? owners.recorder() : owners.editor();
      const trusted = recorder ? !!owner && trustedRecorderSender(event, { sender: owner.webContents, mainFrame: owner.webContents.mainFrame }) : owners.trustedEditor(event);
      if (!trusted) throw new Error('请求来源不受信任');
      if (!cleanup && (!owners.idle() || !owner?.isVisible())) throw new Error('请先结束当前录制，再调试声音');
      return handler(...args);
    });
  };
  handle('studio:microphone-prepare', false, (id, effects) => session.prepareProject(id, effects));
  handle('studio:audio-prepare', false, (id, audio) => session.prepareAudio(id, audio));
  handle('studio:microphone-cancel', false, () => session.cancelPreparation(), true);
  handle('studio:audio-release', false, url => session.releaseMedia(url), true);
  handle('recorder:audio-release', true, url => session.releaseMedia(url), true);
  handle('recorder:microphone-trial-start', true, device => session.startTrial(device));
  handle('recorder:microphone-trial-finish', true, id => session.finishTrial(id));
  handle('recorder:microphone-trial-cancel', true, id => session.cancelTrial(id), true);
  handle('recorder:microphone-trial-process', true, (id, effects) => session.processTrial(id, effects));
}
