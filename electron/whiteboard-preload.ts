import { contextBridge, ipcRenderer } from 'electron';
import type { WhiteboardApi } from '../shared/whiteboard/types';

const api: WhiteboardApi = {
  snapshot: () => ipcRenderer.invoke('whiteboard:snapshot'),
  setVisible: visible => ipcRenderer.invoke('whiteboard:visible', visible),
  chooseMode: () => ipcRenderer.invoke('whiteboard:mode'),
  viewReady: (session, opening) => ipcRenderer.invoke('whiteboard:view-ready', session, opening),
  choosePresentation: () => ipcRenderer.invoke('whiteboard:presentation'),
  setWindowOptions: (session, options) => ipcRenderer.invoke('whiteboard:window-options', session, options),
  setMaximized: (session, maximized) => ipcRenderer.invoke('whiteboard:maximized', session, maximized),
  setBackdrop: (session, backdrop, shade) => ipcRenderer.invoke('whiteboard:backdrop', session, backdrop, shade),
  cameraPreview: {
    previewReady: () => ipcRenderer.invoke('whiteboard:camera-ready'),
    sendPreviewSignal: message => ipcRenderer.invoke('whiteboard:camera-signal', message),
    onPreviewSignal: callback => {
      const listener = (_event: Electron.IpcRendererEvent, message: Parameters<typeof callback>[0]) => callback(message);
      ipcRenderer.on('whiteboard:camera-preview-incoming', listener);
      return () => { ipcRenderer.removeListener('whiteboard:camera-preview-incoming', listener); };
    },
  },
  act: (session, action) => ipcRenderer.invoke('whiteboard:action', session, action),
  importImage: (session, bytes, point) => ipcRenderer.invoke('whiteboard:import-image', session, bytes, point),
  pasteImage: (session, point) => ipcRenderer.invoke('whiteboard:paste-image', session, point),
  speechReady: session => ipcRenderer.invoke('whiteboard:speech-ready', session),
  speechInstall: session => ipcRenderer.invoke('whiteboard:speech-install', session),
  speechStart: session => ipcRenderer.invoke('whiteboard:speech-start', session),
  speechStop: (session, id) => ipcRenderer.invoke('whiteboard:speech-stop', session, id),
  speechCancel: session => ipcRenderer.invoke('whiteboard:speech-cancel', session),
  onSpeechLevel: callback => {
    const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value);
    ipcRenderer.on('whiteboard:speech-level', listener);
    return () => { ipcRenderer.removeListener('whiteboard:speech-level', listener); };
  },
  onState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('whiteboard:state', listener);
    return () => { ipcRenderer.removeListener('whiteboard:state', listener); };
  },
};
contextBridge.exposeInMainWorld('whiteboard', api);
