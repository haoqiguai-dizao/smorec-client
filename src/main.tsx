import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/capture-theme.css';

const root = createRoot(document.getElementById('root')!);
const overlay = new URLSearchParams(window.location.search).get('overlay');
if (['launcher', 'toolbar', 'camera', 'whiteboard', 'permissions'].includes(overlay ?? '')) {
  document.documentElement.classList.add('capture-theme');
}
if (overlay === 'region') {
  void Promise.all([import('./components/recording/RegionPicker'), import('./styles/region-picker.css')]).then(([{ RegionPicker }]) => {
    root.render(<StrictMode><RegionPicker /></StrictMode>);
  });
} else if (overlay === 'export') {
  void import('./services/export-render-entry').then(({ runExportRenderer }) => runExportRenderer());
} else if (overlay === 'whiteboard') {
  void Promise.all([import('./components/whiteboard/Whiteboard'), import('./styles/whiteboard.css')]).then(([{ Whiteboard }]) => {
    root.render(<StrictMode><Whiteboard /></StrictMode>);
  });
} else if (overlay === 'permission-startup') {
  void Promise.all([import('./components/permission-guide/PermissionStartup'), import('./styles/permission-companion.css'), import('./styles/permission-startup.css')]).then(([{ PermissionStartup }]) => {
    root.render(<StrictMode><PermissionStartup /></StrictMode>);
  });
} else if (overlay === 'permissions') {
  void Promise.all([import('./components/permission-guide/PermissionCompanion'), import('./styles/permission-companion.css')]).then(([{ PermissionCompanion }]) => {
    root.render(<StrictMode><PermissionCompanion /></StrictMode>);
  });
} else if (overlay === 'launcher') {
  void Promise.all([import('./components/recorder-launcher/RecorderLauncher'), import('./styles/recorder-launcher.css')]).then(([{ RecorderLauncher }]) => {
    root.render(<StrictMode><RecorderLauncher /></StrictMode>);
  });
} else if (overlay === 'toolbar') {
  // Keep each entry's import separate so production CSS dependencies follow the selected view.
  void Promise.all([import('./components/recording-overlay/RecordingToolbar'), import('./styles/recording-overlay.css')]).then(([{ RecordingToolbar }]) => {
    root.render(<StrictMode><RecordingToolbar /></StrictMode>);
  });
} else if (overlay === 'camera') {
  void Promise.all([import('./components/recording-overlay/CameraOverlay'), import('./styles/recording-overlay.css')]).then(([{ CameraOverlay }]) => {
    root.render(<StrictMode><CameraOverlay /></StrictMode>);
  });
} else {
  void Promise.all([import('./App'), import('./styles/index.css'), import('./app.css')]).then(([{ default: App }]) => {
    root.render(<StrictMode><App /></StrictMode>);
  });
}
