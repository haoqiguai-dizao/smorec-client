import { app, ipcMain, shell, systemPreferences, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { MAC_PERMISSIONS, type MacPermission, type PermissionComponent, type PermissionComponentId } from '../../../shared/platform-permissions';
import { applicationIcon } from '../app-icon';
import type { NativeClient } from '../native-client';

interface OwnedComponent extends PermissionComponent { file: string }
type Sender = IpcMainEvent | IpcMainInvokeEvent;
interface Options { trusted(event: Sender): boolean; busy(): boolean; executable(): string | undefined; native: NativeClient }

/** Resolve only the installed application and its actual capture host, never renderer paths. */
export function permissionComponentFiles(appPath: string, executable?: string): OwnedComponent[] {
  const bundle = path.dirname(path.dirname(path.dirname(appPath)));
  if (!bundle.endsWith('.app') || !existsSync(path.join(bundle, 'Contents/Info.plist'))) return [];
  const main = realpathSync(bundle);
  // A renamed updater copy is evidence/recovery material, never an authorization
  // target. Do not silently redirect it to an app that this process did not load.
  if (/^\.xiaolu-(?:failed|previous|incoming)-/.test(path.basename(main))
    || main.split(path.sep).some(part => /^\.xiaolu-incoming-/.test(part))) return [];
  const result: OwnedComponent[] = [{ id: 'application', name: '小录', role: '主应用', file: main }];
  if (!executable) return result;
  const capture = path.dirname(path.dirname(path.dirname(executable)));
  if (!capture.endsWith('.app') || !existsSync(path.join(capture, 'Contents/Info.plist'))) return result;
  const target = realpathSync(capture);
  if (target !== path.join(main, 'Contents/Resources/native/XiaoLu.Capture.app')) return result;
  result.push({ id: 'capture', name: '小录采集', role: '录制组件', file: target });
  return result;
}

export function installPermissionComponents(options: Options): void {
  const check = (event: Sender, args: unknown[], count: number): MacPermission => {
    if (!options.trusted(event) || args.length !== count || process.platform !== 'darwin') throw new Error('权限组件请求来源或参数无效');
    if (options.busy()) throw new Error('请先结束录制、推流或导出，再设置授权');
    if (!MAC_PERMISSIONS.includes(args[0] as MacPermission)) throw new Error('权限类型无效');
    return args[0] as MacPermission;
  };
  const components = (kind: MacPermission) => permissionComponentFiles(app.getAppPath(), options.executable())
    .filter(item => kind === 'screen' || item.id === (kind === 'camera' ? 'application' : 'capture'));
  const resolve = (event: Sender, args: unknown[]) => {
    const kind = check(event, args, 2);
    const item = components(kind).find(item => item.id === args[1] as PermissionComponentId);
    if (!item) throw new Error('当前安装中没有对应授权组件，请重新安装小录');
    return item;
  };
  ipcMain.handle('platform:permission-components', async (event, ...args: unknown[]) => {
    const kind = check(event, args, 1);
    const items = components(kind).map(({ id, name, role }) => ({ id, name, role }));
    if (kind !== 'screen') return items;
    const native = await options.native.request<{ screenPermission: boolean }>('capabilities');
    return items.map(item => ({ ...item, granted: item.id === 'application'
      ? systemPreferences.getMediaAccessStatus('screen') === 'granted' : native.screenPermission }));
  });
  ipcMain.handle('platform:permission-reveal', (event, ...args: unknown[]) => {
    shell.showItemInFolder(resolve(event, args).file);
  });
  // startDrag must run synchronously in the native drag gesture; no async file operations here.
  ipcMain.on('platform:permission-drag', (event, ...args: unknown[]) => {
    if (!options.trusted(event)) return;
    try {
      const item = resolve(event, args), icon = applicationIcon();
      if (!icon) throw new Error('授权组件图标暂不可用，请使用定位组件');
      event.sender.startDrag({ file: item.file, icon: icon.resize({ width: 64, height: 64 }) });
    } catch (error) {
      event.sender.send('platform:permission-component-error', error instanceof Error ? error.message : '无法拖出授权组件');
    }
  });
}
