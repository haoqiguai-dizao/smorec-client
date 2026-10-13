import { contextBridge, ipcRenderer } from 'electron';
import type { LiveApi } from '../shared/live-types';

function subscribe<T>(name: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(name, listener);
  return () => { ipcRenderer.removeListener(name, listener); };
}
const api: LiveApi = {
  profiles: { list: () => ipcRenderer.invoke('live:profiles-list'), read: id => ipcRenderer.invoke('live:profiles-read', id),
    save: value => ipcRenderer.invoke('live:profiles-save', value), remove: id => ipcRenderer.invoke('live:profiles-remove', id) },
  applications: () => ipcRenderer.invoke('live:applications'),
  status: () => ipcRenderer.invoke('live:status'), install: () => ipcRenderer.invoke('live:install'),
  setExcludedApplications: (id, applications) => ipcRenderer.invoke('live:exclusions', id, applications),
  start: value => ipcRenderer.invoke('live:start', value), pull: id => ipcRenderer.invoke('live:pull', id),
  broadcast: id => ipcRenderer.invoke('live:broadcast', id),
  setAudio: (id, channel, enabled) => ipcRenderer.invoke('live:audio', id, channel, enabled),
  push: (id, pixels) => ipcRenderer.invoke('live:push', id, pixels), stop: () => ipcRenderer.invoke('live:stop'),
  report: (id, issue) => ipcRenderer.invoke('live:report', id, issue),
  hideControls: () => ipcRenderer.invoke('live:hide'),
  onState: callback => subscribe('live:state', callback), onAction: callback => subscribe('live:action', callback),
  onPreviewVisibility: callback => {
    const remove = subscribe<boolean>('live:preview-visibility', callback);
    ipcRenderer.send('live:preview-watch');
    return remove;
  },
};
contextBridge.exposeInMainWorld('live', api);
