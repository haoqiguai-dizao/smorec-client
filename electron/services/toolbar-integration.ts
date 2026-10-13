import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { installToolbarPresentation } from './toolbar-presentation';
import { setWindowInputRegions } from './platform/window-regions';
import { trustedRecorderSender } from './recorder-launcher/validation';
import { trustedOverlaySender } from './recording-overlay/validation';

export interface ToolbarActivity { recording: boolean; live: boolean; exporting: boolean; quitting: boolean }
interface Options {
  launcher(): BrowserWindow | undefined;
  toolbar(): BrowserWindow | undefined;
  activity(): ToolbarActivity;
  quit(): Promise<void>;
}

/** Preparation and active controls share the owned application's saved shutdown path. */
export function installToolbarIntegration(options: Options): void {
  const resolveWindow = (event: IpcMainInvokeEvent) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    return target && (target === options.launcher() || target === options.toolbar()) ? target : undefined;
  };
  installToolbarPresentation({ ipcMain, setRegions: setWindowInputRegions, resolveWindow });
  ipcMain.handle('toolbar:quit', async (event, ...args: unknown[]) => {
    const target = resolveWindow(event);
    if (!target || target.isDestroyed()) throw new Error('操作栏窗口已关闭');
    const owner = { sender: target.webContents, mainFrame: target.webContents.mainFrame };
    if (args.length || !trustedRecorderSender(event, owner) && !trustedOverlaySender(event, owner, 'toolbar')) {
      throw new Error('退出请求来源或参数无效');
    }
    const active = options.activity();
    if (active.quitting) return false;
    if (active.exporting) throw new Error('请先完成或取消导出，再退出小录');
    if (active.recording || active.live) {
      const result = await dialog.showMessageBox(target, { type: 'question', title: '退出小录',
        message: active.recording ? '停止录制并退出小录？' : '停止直播输出并退出小录？',
        detail: active.recording ? '当前录制会先停止并保存。' : '当前推流或虚拟摄像头输出将结束。',
        buttons: ['取消', '停止并退出'], defaultId: 0, cancelId: 0, noLink: true });
      if (result.response !== 1) return false;
      if (options.activity().exporting) throw new Error('请先完成或取消导出，再退出小录');
    }
    await options.quit();
    return true;
  });
}
