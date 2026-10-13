import { contextBridge, ipcRenderer } from 'electron';
import type { DemoApi, DemoState } from '../shared/demo';
const api: DemoApi = {
  getState: () => ipcRenderer.invoke('demo:state'),
  menu: () => ipcRenderer.invoke('demo:menu'),
  onState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: DemoState) => callback(state);
    ipcRenderer.on('demo:changed', listener);
    return () => ipcRenderer.removeListener('demo:changed', listener);
  },
};
contextBridge.exposeInMainWorld('demo', api);
