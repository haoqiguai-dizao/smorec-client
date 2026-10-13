import { contextBridge, ipcRenderer } from 'electron';
import './toolbar-preload';
import './demo-preload';
import './whiteboard-preload';
import type { CameraPreviewMessage, LiveRecordingState, RecordingOverlayApi } from '../shared/types';

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.platform = process.platform;
}, { once: true });

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}
const api: RecordingOverlayApi = {
  getState: () => ipcRenderer.invoke('recording-overlay:get-state'),
  onState: callback => subscribe<LiveRecordingState>('recording-overlay:state', callback),
  control: action => ipcRenderer.invoke('recording-overlay:control', action),
  setExpanded: expanded => ipcRenderer.invoke('recording-overlay:expanded', expanded),
  setCameraSettings: open => ipcRenderer.invoke('recording-overlay:camera-settings', open),
  previewReady: () => ipcRenderer.invoke('recording-overlay:preview-ready'),
  sendPreviewSignal: message => ipcRenderer.invoke('recording-overlay:preview-signal', message),
  onPreviewSignal: callback => subscribe<CameraPreviewMessage>('recording-overlay:preview-incoming', callback),
};
contextBridge.exposeInMainWorld('recordingOverlay', api);
