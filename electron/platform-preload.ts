import { contextBridge, ipcRenderer } from 'electron';
import type { PlatformPermissionsApi } from '../shared/platform-permissions';

const api: PlatformPermissionsApi = {
  ...(process.platform === 'darwin' ? { cameraStatus: () => ipcRenderer.invoke('platform:camera-status') } : {}),
  get: () => ipcRenderer.invoke('platform:permissions'),
  request: (kind, component) => component ? ipcRenderer.invoke('platform:permission-request', kind, component)
    : ipcRenderer.invoke('platform:permission-request', kind),
  openSettings: kind => ipcRenderer.invoke('platform:permission-settings', kind),
  components: kind => ipcRenderer.invoke('platform:permission-components', kind),
  dragComponent: (kind, id) => ipcRenderer.send('platform:permission-drag', kind, id),
  revealComponent: (kind, id) => ipcRenderer.invoke('platform:permission-reveal', kind, id),
  onComponentError: callback => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => callback(message);
    ipcRenderer.on('platform:permission-component-error', listener);
    return () => { ipcRenderer.removeListener('platform:permission-component-error', listener); };
  },
};
contextBridge.exposeInMainWorld('platformPermissions', api);
