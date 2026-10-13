import { contextBridge, ipcRenderer } from 'electron';
import './live-preload';
import './region-preload';
import './demo-preload';
import './toolbar-preload';
import './distribution-preload';
import './platform-preload';
import './permission-guide-preload';
import './audio-cache-preload';
import './overlay-preload';
import type { CameraCommand, CameraEffects, CameraPreviewMessage, RecorderApi, RecordingState } from '../shared/types';

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

const api: RecorderApi = {
  startMicrophoneTrial: device => ipcRenderer.invoke('recorder:microphone-trial-start', device),
  finishMicrophoneTrial: id => ipcRenderer.invoke('recorder:microphone-trial-finish', id),
  cancelMicrophoneTrial: id => ipcRenderer.invoke('recorder:microphone-trial-cancel', id),
  processMicrophoneTrial: (id, effects) => ipcRenderer.invoke('recorder:microphone-trial-process', id, effects),
  releaseAudio: url => ipcRenderer.invoke('recorder:audio-release', url),
  getStatus: () => ipcRenderer.invoke('recorder:status'),
  getSources: () => ipcRenderer.invoke('recorder:sources'),
  getMicrophones: () => ipcRenderer.invoke('recorder:microphones'),
  startRecording: options => ipcRenderer.invoke('recorder:record-start', options),
  setExcludedApplications: applications => ipcRenderer.invoke('recorder:record-exclusions', applications),
  onRecordingState: callback => subscribe<RecordingState>('recorder:record-state', callback),
  cameraPrepare: () => ipcRenderer.invoke('recorder:camera-prepare'),
  attachRecordingCamera: id => ipcRenderer.invoke('recorder:camera-attach', id),
  cameraStarted: (id, timestamp, mimeType) => ipcRenderer.invoke('recorder:camera-started', id, timestamp, mimeType),
  cameraAppend: (id, data) => ipcRenderer.invoke('recorder:camera-append', id, data),
  cameraFinish: id => ipcRenderer.invoke('recorder:camera-finish', id),
  cameraCancel: id => ipcRenderer.invoke('recorder:camera-cancel', id),
  cameraFrameStall: (id, stalledSeconds) => ipcRenderer.invoke('recorder:camera-frame-stall', id, stalledSeconds),
  cameraFrameResumed: id => ipcRenderer.invoke('recorder:camera-frame-resumed', id),
  onCameraCommand: callback => subscribe<CameraCommand>('recorder:camera-command', callback),
  onCameraPreviewRequest: callback => subscribe<string>('recorder:camera-preview-request', callback),
  cameraPreviewSignal: message => ipcRenderer.invoke('recorder:camera-preview-signal', message),
  cameraPreviewQuality: (id, detail) => ipcRenderer.invoke('recorder:camera-preview-quality', id, detail),
  cameraPreviewReady: (id, effects) => ipcRenderer.invoke('recorder:camera-preview-ready', id, effects),
  cameraPreviewClosed: id => ipcRenderer.invoke('recorder:camera-preview-closed', id),
  cameraPreviewCountdown: (id, value) => ipcRenderer.invoke('recorder:camera-preview-countdown', id, value),
  onCameraEnabledChange: callback => subscribe<boolean>('recorder:camera-enabled', callback),
  onCameraEffectsChange: callback => subscribe<CameraEffects>('recorder:camera-effects', callback),
  onCameraPreviewSignal: callback => subscribe<CameraPreviewMessage>('recorder:camera-preview-signal', callback),
  openEditor: () => ipcRenderer.invoke('recorder:open-editor'),
  openCameraSettings: () => ipcRenderer.invoke('recorder:open-camera-settings'),
  setExpanded: expanded => ipcRenderer.invoke('recorder:expanded', expanded),
  dragWindow: action => ipcRenderer.invoke('recorder:drag-window', action),
  onActivate: callback => {
    const remove = subscribe<void>('recorder:activate', callback);
    ipcRenderer.send('recorder:ready');
    return remove;
  },
  quit: () => ipcRenderer.invoke('recorder:quit'),
};

contextBridge.exposeInMainWorld('recorder', api);
