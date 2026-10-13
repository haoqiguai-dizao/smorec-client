import { contextBridge, ipcRenderer } from 'electron';
import type { PermissionGuideApi, PermissionGuideAction, PermissionGuideContext, PermissionGuideHelpAction } from '../shared/permission-guide';

const subscribe = <T>(channel: string, callback: (value: T) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
};
const api: PermissionGuideApi = {
  show: context => ipcRenderer.invoke('permission-guide:show', context),
  dismiss: () => ipcRenderer.invoke('permission-guide:dismiss'),
  context: () => ipcRenderer.invoke('permission-guide:context'),
  action: action => ipcRenderer.invoke('permission-guide:action', action),
  step: kind => ipcRenderer.invoke('permission-guide:step', kind),
  help: () => ipcRenderer.invoke('permission-guide:help'),
  onContext: callback => subscribe<PermissionGuideContext>('permission-guide:context-changed', callback),
  onAction: callback => subscribe<PermissionGuideAction>('permission-guide:owner-action', callback),
  onHelpAction: callback => subscribe<PermissionGuideHelpAction>('permission-guide:help-action', callback),
};
contextBridge.exposeInMainWorld('permissionGuide', api);
