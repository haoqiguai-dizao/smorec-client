import { dialog, Menu, type BrowserWindow } from 'electron';
import type { PermissionGuideAction, PermissionGuideContext, PermissionGuideHelpAction } from '../../../shared/permission-guide';

export function showPermissionGuideHelp(window: BrowserWindow, context: PermissionGuideContext,
  busy: () => boolean, help: (action: PermissionGuideHelpAction) => void, choose: (action: PermissionGuideAction) => void) {
  const run = (action: PermissionGuideHelpAction) => { if (!busy() && !window.isDestroyed()) help(action); };
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: '列表里已有同名组件？直接打开开关', enabled: false },
    { label: '重新打开系统设置', click: () => run('settings') },
    { label: '在访达中找到小录', click: () => run('reveal') },
    { label: '重新检查', click: () => run('refresh') },
  ];
  if (!context.startup && context.needs.includes(context.kind)) {
    if (context.kind === 'input' || context.kind === 'accessibility') items.push({ type: 'separator' },
      { label: context.mode === 'live' ? '本次不使用自动镜头' : '本次仅录画面与声音', click: () => { if (!busy()) choose('skip-input'); } });
    else if (context.kind === 'camera' || context.kind === 'microphone') items.push({ type: 'separator' },
      { label: context.kind === 'camera' ? '不使用摄像头' : '不使用麦克风', click: () => { if (!busy()) choose(context.kind === 'camera' ? 'disable-camera' : 'disable-microphone'); } });
  }
  items.push({ type: 'separator' }, { label: '授权说明', click: () => {
    if (busy() || window.isDestroyed()) return;
    void dialog.showMessageBox(window, { type: 'info', title: '小录授权说明', message: '添加小录，再打开对应开关',
      detail: '已有小录时直接打开开关；没有时把整条组件拖入列表，系统不支持拖入时用“＋”添加。拖拽取消或未添加进去时点“重试”。\n\n自动镜头需要输入监控和辅助功能，只记录位置与活动时间，不记录输入文字。\n\n拖入不会安装或替换软件。系统要求重开时，请先结束任务；小录不会自动停止或重启。', buttons: ['知道了'] });
  } });
  Menu.buildFromTemplate(items).popup({ window });
}
