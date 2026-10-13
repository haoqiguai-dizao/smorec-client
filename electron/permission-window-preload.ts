import './platform-preload';
import './permission-guide-preload';
import { contextBridge, ipcRenderer } from 'electron';
import type { PermissionStartupApi } from '../shared/permission-startup';
const startup: PermissionStartupApi = {
  enter: () => ipcRenderer.invoke('permission-startup:enter'),
  quit: () => ipcRenderer.invoke('permission-startup:quit'),
};
contextBridge.exposeInMainWorld('permissionStartup', startup);
