import { Menu, type MenuItemConstructorOptions, type Tray } from 'electron';
import { trayIcon } from './tray-icon';
import { APP_NAME } from '../../shared/brand';
import { shortcutLabel } from '../../shared/shortcut-label';

export function updateAppTray(tray: Tray | undefined, options: {
  recording: boolean; live: boolean; demo: MenuItemConstructorOptions[];
  wake(): void; stop(): Promise<void>; quit(): Promise<void>;
}): void {
  if (!tray) return;
  const active = options.recording || options.live;
  tray.setImage(trayIcon(active));
  tray.setToolTip(active ? `${APP_NAME} · ${options.live ? '直播投屏' : '正在录制'} · ${shortcutLabel('Ctrl+Shift+R', process.platform)} 停止` : APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: options.live ? '显示直播操作栏' : '打开录制栏', click: options.wake },
    ...options.demo.slice(0, 1),
    ...(options.demo[0]?.checked ? [{ label: '演示选项', submenu: options.demo.slice(1) }] : []),
    { label: shortcutLabel(options.live ? '结束直播投屏  Ctrl+Shift+R' : '停止录制并编辑  Ctrl+Shift+R', process.platform), enabled: active, click: () => { void options.stop(); } },
    { type: 'separator' }, { label: active ? `停止并退出${APP_NAME}…` : `退出${APP_NAME}`, click: () => { void options.quit(); } },
  ]));
}
