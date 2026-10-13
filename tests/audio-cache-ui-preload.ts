import '../electron/audio-cache-preload';
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('cacheTest', {
  inspect: () => ipcRenderer.invoke('audio-cache-test:inspect'),
  release: () => ipcRenderer.invoke('audio-cache-test:release'),
});
