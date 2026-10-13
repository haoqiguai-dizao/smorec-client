import { contextBridge, ipcRenderer } from 'electron';
import type { ToolbarPresentationApi } from '../shared/toolbar-types';

const api: ToolbarPresentationApi = {
  setRegions: regions => ipcRenderer.invoke('toolbar-presentation:regions', regions),
  quit: () => ipcRenderer.invoke('toolbar:quit'),
};
contextBridge.exposeInMainWorld('toolbarPresentation', api);
