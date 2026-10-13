import { contextBridge, ipcRenderer } from 'electron';
import type { AudioCacheApi } from '../shared/audio-cache';
const api: AudioCacheApi = {
  state: () => ipcRenderer.invoke('audio-cache:state'),
  clear: () => ipcRenderer.invoke('audio-cache:clear'),
};
contextBridge.exposeInMainWorld('audioCache', api);
