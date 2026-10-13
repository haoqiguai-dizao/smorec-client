import { contextBridge, ipcRenderer } from 'electron';
import type { ExportRendererApi } from '../shared/export-render';

const api: ExportRendererApi = {
  ready: () => ipcRenderer.invoke('export-renderer:ready'),
  getStatus: () => ipcRenderer.invoke('export-renderer:status'),
  exportStart: (_project, settings) => ipcRenderer.invoke('export-renderer:start', settings),
  cancelExportPreparation: () => ipcRenderer.invoke('export-renderer:cancel-preparation'),
  exportAppend: (id, data) => ipcRenderer.invoke('export-renderer:append', id, data),
  exportFinish: id => ipcRenderer.invoke('export-renderer:finish', id),
  exportCancel: id => ipcRenderer.invoke('export-renderer:cancel', id),
  progress: value => ipcRenderer.send('export-renderer:progress', value),
  complete: value => ipcRenderer.send('export-renderer:complete', value),
  onCancel: callback => {
    const listener = () => callback();
    ipcRenderer.on('export-renderer:abort', listener);
    return () => { ipcRenderer.removeListener('export-renderer:abort', listener); };
  },
};
contextBridge.exposeInMainWorld('exportRenderer', api);
