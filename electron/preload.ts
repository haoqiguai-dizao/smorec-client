import { contextBridge, ipcRenderer } from 'electron';
import './demo-preload';
import './region-preload';
import type { CameraCommand, CameraPreviewMessage, Project, RecordingState, StudioApi } from '../shared/types';

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}
const closeCallbacks = new Set<() => Promise<void>>();
ipcRenderer.on('studio:before-close', (_event: Electron.IpcRendererEvent, token: string) => {
  Promise.all([...closeCallbacks].map((callback) => Promise.resolve().then(callback)))
    .then(() => ipcRenderer.send('studio:close-ready', { token, ok: true }))
    .catch((error: unknown) => ipcRenderer.send('studio:close-ready', {
      token, ok: false, error: error instanceof Error ? error.message : '自动保存失败',
    }));
});
const api: StudioApi = {
  prepareAudio: (id, audio) => ipcRenderer.invoke('studio:audio-prepare', id, audio),
  prepareMicrophone: (id, effects) => ipcRenderer.invoke('studio:microphone-prepare', id, effects),
  cancelMicrophonePreparation: () => ipcRenderer.invoke('studio:microphone-cancel'),
  releaseAudio: url => ipcRenderer.invoke('studio:audio-release', url),
  openRecorder: () => ipcRenderer.invoke('studio:open-recorder'),
  getStatus: () => ipcRenderer.invoke('studio:status'),
  getSources: () => ipcRenderer.invoke('studio:sources'),
  getMicrophones: () => ipcRenderer.invoke('studio:microphones'),
  startRecording: (options) => ipcRenderer.invoke('studio:record-start', options),
  stopRecording: () => ipcRenderer.invoke('studio:record-stop'),
  onRecordingState: (callback) => subscribe<RecordingState>('studio:record-state', callback),
  onProjectReady: callback => {
    const unsubscribe = subscribe<Project>('studio:project-ready', callback);
    ipcRenderer.send('studio:ready');
    return unsubscribe;
  },
  onBeforeClose: (callback) => { closeCallbacks.add(callback); return () => { closeCallbacks.delete(callback); }; },
  cameraPrepare: () => ipcRenderer.invoke('studio:camera-prepare'),
  cameraStarted: (id, timestamp, mimeType) => ipcRenderer.invoke('studio:camera-started', id, timestamp, mimeType),
  cameraAppend: (id, data) => ipcRenderer.invoke('studio:camera-append', id, data),
  cameraFinish: (id) => ipcRenderer.invoke('studio:camera-finish', id),
  cameraCancel: (id) => ipcRenderer.invoke('studio:camera-cancel', id),
  cameraFrameStall: (id, stalledSeconds) => ipcRenderer.invoke('studio:camera-frame-stall', id, stalledSeconds),
  cameraFrameResumed: (id) => ipcRenderer.invoke('studio:camera-frame-resumed', id),
  onCameraCommand: (callback) => subscribe<CameraCommand>('studio:camera-command', callback),
  onCameraPreviewRequest: callback => subscribe<string>('studio:camera-preview-request', callback),
  cameraPreviewSignal: message => ipcRenderer.invoke('studio:camera-preview-signal', message),
  cameraPreviewQuality: (id, detail) => ipcRenderer.invoke('studio:camera-preview-quality', id, detail),
  onCameraPreviewSignal: callback => subscribe<CameraPreviewMessage>('studio:camera-preview-signal', callback),
  listProjects: () => ipcRenderer.invoke('studio:projects'),
  loadProject: (id) => ipcRenderer.invoke('studio:project-load', id),
  saveProject: (project) => ipcRenderer.invoke('studio:project-save', project),
  renameProject: (id, name) => ipcRenderer.invoke('studio:project-rename', id, name),
  revealProject: (id) => ipcRenderer.invoke('studio:project-reveal', id),
  deleteProjects: (ids) => ipcRenderer.invoke('studio:project-delete', ids),
  importVideo: () => ipcRenderer.invoke('studio:import'),
  importBackground: (id) => ipcRenderer.invoke('studio:background-import', id),
  openProject: () => ipcRenderer.invoke('studio:project-open'),
  renderExport: project => ipcRenderer.invoke('studio:export-render', project),
  cancelRenderExport: () => ipcRenderer.invoke('studio:export-render-cancel'),
  onRenderExportProgress: callback => subscribe('studio:export-render-progress', callback),
  exportStart: (project, settings) => ipcRenderer.invoke('studio:export-start', project, settings),
  cancelExportPreparation: () => ipcRenderer.invoke('studio:export-cancel-preparation'),
  exportAppend: (id, data) => ipcRenderer.invoke('studio:export-append', id, data),
  exportFinish: (id) => ipcRenderer.invoke('studio:export-finish', id),
  exportCancel: (id) => ipcRenderer.invoke('studio:export-cancel', id),
  revealExport: (file) => ipcRenderer.invoke('studio:export-reveal', file),
  minimize: () => ipcRenderer.send('studio:window', 'minimize'),
  maximize: () => ipcRenderer.send('studio:window', 'maximize'),
  close: () => ipcRenderer.send('studio:window', 'close'),
};
contextBridge.exposeInMainWorld('studio', api);
