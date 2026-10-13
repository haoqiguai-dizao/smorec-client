import { ipcMain, type BrowserWindow } from 'electron';
import type { RecorderLauncher } from '../recorder-launcher';
import type { LiveSession } from './session';
import { installVirtualCamera, virtualCameraStatus } from './virtual-camera';
import type { LiveApplication } from '../../../shared/live-types';
import { streamProfiles } from '../streaming/store';
import { watchPreviewVisibility } from './preview-visibility';

export function installLiveIpc(launcher: RecorderLauncher, session: LiveSession, idle: () => boolean, hide: () => void,
  applications: () => Promise<LiveApplication[]>): void {
  const handle = (name: string, count: number, callback: (...args: unknown[]) => unknown) => {
    ipcMain.handle('live:' + name, (event, ...args) => {
      if (!launcher.isTrusted(event) || args.length !== count) throw new Error('直播请求来源或参数无效');
      return callback(...args);
    });
  };
  handle('status', 0, virtualCameraStatus);
  handle('profiles-list', 0, () => streamProfiles.list());
  handle('profiles-read', 1, id => streamProfiles.read(id));
  handle('profiles-save', 1, value => {
    if (session.active()) throw new Error('请先结束直播再修改推流配置');
    return streamProfiles.save(value);
  });
  handle('profiles-remove', 1, id => {
    if (session.active()) throw new Error('请先结束直播再删除推流配置');
    return streamProfiles.remove(id);
  });
  handle('applications', 0, applications);
  handle('install', 0, () => {
    if (!idle() || session.active()) throw new Error('请先结束采集后安装虚拟摄像头');
    return installVirtualCamera();
  });
  handle('start', 1, value => session.start(value));
  handle('broadcast', 1, id => session.broadcast(id));
  handle('audio', 3, (id, channel, enabled) => session.setAudio(id, channel, enabled));
  handle('exclusions', 2, (id, applications) => session.setExcludedApplications(id, applications));
  handle('pull', 1, id => session.pull(id));
  handle('push', 2, (id, pixels) => session.push(id, pixels));
  handle('stop', 0, () => session.stop());
  handle('report', 2, (id, issue) => session.report(id, issue));
  handle('hide', 0, () => { if (session.active()) hide(); });
  const watched = new WeakMap<BrowserWindow, ReturnType<typeof watchPreviewVisibility>>();
  ipcMain.on('live:preview-watch', (event, ...args) => {
    if (!launcher.isTrusted(event) || args.length) return;
    const window = launcher.getWindow();
    if (!window) return;
    if (!watched.has(window)) watched.set(window, watchPreviewVisibility(window, visible => {
      if (!window.webContents.isDestroyed()) window.webContents.send('live:preview-visibility', visible);
    }));
    watched.get(window)!.publish();
  });
}
