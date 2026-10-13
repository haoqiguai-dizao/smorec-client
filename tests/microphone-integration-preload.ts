import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('microphoneIntegration', { call: (method: string, ...args: unknown[]) => ipcRenderer.invoke('microphone-integration', method, ...args) });
