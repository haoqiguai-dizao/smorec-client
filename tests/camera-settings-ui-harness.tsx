import { cameraZoomPixels } from './camera-zoom-render-harness';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CameraOverlay } from '../src/components/recording-overlay/CameraOverlay';
import { CameraSettingsWindow } from '../electron/services/recording-overlay/camera-settings-window';
import { cameraOverlayBounds, cameraSettingsReserve, presenterCameraBounds } from '../electron/services/recording-overlay/geometry';
import { DEFAULT_CAMERA_EFFECTS } from '../shared/camera-effects';
import type { LiveRecordingState, RecordingControlAction, RecordingOverlayApi } from '../shared/types';

const area = { x: 0, y: 0, width: 1280, height: 800 };
const listeners = new Set<(state: LiveRecordingState) => void>();
const actions: RecordingControlAction[] = [];
let live: LiveRecordingState = { status: 'idle', cameraPreviewing: true, cameraAvailable: true, cameraVisible: true,
  cameraSessionId: 'synthetic-camera', cameraShape: 'circle', cameraSize: .3, cameraMirror: true, cameraMode: 'overlay',
  cameraEffects: { ...DEFAULT_CAMERA_EFFECTS }, microphoneEnabled: false, microphoneMuted: false, microphoneName: '',
  systemAudioEnabled: false, systemAudioMuted: false };
const base = () => live.cameraMode === 'presenter' ? presenterCameraBounds(area)
  : cameraOverlayBounds(area, live.cameraSize, { x: .35, y: .58 }, live.cameraShape);
let outer = base(), updateSurface: (bounds: typeof outer) => void;
let regions: typeof outer[] = [];
const settingsWindow = new CameraSettingsWindow({ bounds: () => outer, request: () => outer,
  area: () => area, setBounds: bounds => { outer = bounds; }, setRegions: value => { regions = value; },
  layoutKey: () => `${live.cameraMode}:${live.cameraShape}`,
  reserve: bounds => live.cameraMode === 'presenter' ? bounds : cameraSettingsReserve(bounds, area, { x: .35, y: .58 }, live.cameraShape) });
function publish() { updateSurface?.(outer); for (const listener of listeners) listener({ ...live }); }
function panel(open: boolean) {
  const camera = base();
  live = { ...live, cameraViewport: { width: camera.width, height: camera.height } };
  if (open) {
    if (settingsWindow.layout) settingsWindow.resize(camera);
    else { outer = camera; settingsWindow.open(); }
  } else { settingsWindow.close(); outer = camera; }
  live = { ...live, cameraPanel: settingsWindow.layout };
  publish();
}
const api: RecordingOverlayApi = {
  getState: async () => live, onState: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
  setCameraSettings: async open => panel(open), setExpanded: async () => {},
  previewReady: async () => ({ sessionId: 'synthetic-preview' }), sendPreviewSignal: async () => {}, onPreviewSignal: () => () => {},
  control: async action => {
    actions.push(action);
    if (action.type === 'camera-mode') { live = { ...live, cameraMode: action.value }; panel(false); return; }
    if (action.type === 'camera-effects') live = { ...live, cameraEffects: { ...live.cameraEffects!, ...action.value } };
    if (action.type === 'camera-mirror') live = { ...live, cameraMirror: action.value };
    if (action.type === 'camera-zoom') live = { ...live, cameraZoom: action.value };
    if (action.type === 'camera-size') live = { ...live, cameraSize: action.value };
    if (action.type === 'camera-shape') live = { ...live, cameraShape: action.value };
    panel(!!live.cameraPanel);
  },
};
window.recordingOverlay = api;
Object.assign(window, { cameraSettingsUi: {
  state: () => ({ live, actions, outer, regions }),
  pixels: cameraZoomPixels,
  patch: (patch: Partial<LiveRecordingState>) => {
    live = { ...live, ...patch };
    panel(!(patch.countdown !== undefined || ['starting', 'stopping'].includes(patch.status ?? '')) && !!live.cameraPanel);
  },
} });
function Harness() {
  const [bounds, setBounds] = useState(outer); updateSurface = setBounds;
  return <div style={{ position: 'absolute', left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height }}><CameraOverlay /></div>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
