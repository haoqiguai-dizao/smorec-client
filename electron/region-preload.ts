import { contextBridge, ipcRenderer } from 'electron';
import type { RegionSelectionApi } from '../shared/region-selection';
const api: RegionSelectionApi = {
  select: (sourceId, initial) => ipcRenderer.invoke('region:select', sourceId, initial),
  configuration: () => ipcRenderer.invoke('region:configuration'),
  complete: crop => ipcRenderer.invoke('region:complete', crop), cancel: () => ipcRenderer.invoke('region:cancel'),
};
contextBridge.exposeInMainWorld('regionSelection', api);
