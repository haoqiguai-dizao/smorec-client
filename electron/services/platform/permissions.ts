import { desktopCapturer, ipcMain, shell, systemPreferences } from 'electron';
import { MAC_PERMISSIONS, type MacCameraStatus, type MacPermission } from '../../../shared/platform-permissions';
import type { NativeClient } from '../native-client';
import { installPermissionComponents } from './permission-components';
import { PermissionGuideWindow } from './permission-guide-window';
import { withSystemPermissionFocus } from './system-permission-focus';
import { readPlatformPermissions } from './permission-status';

interface Options { trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean; busy(): boolean; native: NativeClient }
const panes: Record<MacPermission, string> = {
  screen: 'Privacy_ScreenCapture', camera: 'Privacy_Camera', microphone: 'Privacy_Microphone',
  input: 'Privacy_ListenEvent', accessibility: 'Privacy_Accessibility',
};

/** Settings are read without prompting. Permission requests require an owned launcher's explicit IPC. */
export function installPlatformPermissions(options: Options): void {
  const guide = new PermissionGuideWindow(options);
  const trusted = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) => options.trusted(event) || guide.isTrusted(event);
  installPermissionComponents({ trusted, busy: options.busy, executable: () => options.native.executable(), native: options.native });
  const check = (event: Electron.IpcMainInvokeEvent, count: number, args: unknown[]) => {
    if (!trusted(event) || args.length !== count) throw new Error('权限请求来源或参数无效');
    if (process.platform !== 'darwin') throw new Error('当前系统不使用 Mac 权限设置');
  };
  ipcMain.handle('platform:permissions', async (event, ...args: unknown[]) => {
    check(event, 0, args);
    return readPlatformPermissions(options.native);
  });
  ipcMain.handle('platform:camera-status', async (event, ...args: unknown[]): Promise<MacCameraStatus> => {
    check(event, 0, args);
    return options.native.request<MacCameraStatus>('camera-status');
  });
  let requesting = false;
  ipcMain.handle('platform:permission-request', async (event, ...args: unknown[]) => {
    check(event, args.length === 2 ? 2 : 1, args);
    if (options.busy()) throw new Error('请先结束录制、投屏或导出，再调整系统权限');
    if (!MAC_PERMISSIONS.includes(args[0] as MacPermission)) throw new Error('权限类型无效');
    const kind = args[0] as MacPermission;
    const component = args[1];
    if (component !== undefined && (kind !== 'screen' || !['application', 'capture'].includes(component as string))) throw new Error('授权组件无效');
    if (requesting) throw new Error('请先完成正在处理的授权');
    requesting = true;
    try { return await withSystemPermissionFocus(async () => {
      if (kind === 'microphone') {
        const result = await options.native.request<{ granted: boolean }>('request-microphone');
        if (result.granted) return;
      } else if (kind === 'camera') {
        if (systemPreferences.getMediaAccessStatus(kind) === 'not-determined') {
          if (await systemPreferences.askForMediaAccess(kind)) return;
        }
      } else if (kind === 'screen') {
        if (component === 'capture' || component === undefined && systemPreferences.getMediaAccessStatus('screen') === 'granted') {
          await options.native.request('request-screen');
        } else if (systemPreferences.getMediaAccessStatus('screen') === 'not-determined') {
          await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        } else {
          await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + panes.screen);
        }
      } else if (kind === 'input') {
        await options.native.request('request-input');
      } else if (kind === 'accessibility') {
        await options.native.request('request-accessibility');
      }
      // The system prompt owns opening Settings. Do not compete with it or trigger the next permission.
    }); } finally { requesting = false; }
  });
  ipcMain.handle('platform:permission-settings', async (event, ...args: unknown[]) => {
    check(event, 1, args);
    if (options.busy()) throw new Error('请先结束录制、投屏或导出，再调整系统权限');
    if (!MAC_PERMISSIONS.includes(args[0] as MacPermission)) throw new Error('权限类型无效');
    return withSystemPermissionFocus(async () => {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?' + panes[args[0] as MacPermission]);
      void guide.positionBySettings();
    });
  });
}
