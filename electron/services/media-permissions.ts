import type { BrowserWindow } from 'electron';
import type { CameraManager } from './camera';
import { diagnostic } from './diagnostics';

function diagnosticUrl(value?: string): string | undefined {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol;
    return `${url.protocol}//${url.host}${url.pathname}`;
  }
  catch { return '(invalid URL)'; }
}

/** An explicit camera attempt grants video access to this trusted window for its lifetime.
 * Capture cleanup must not revoke device discovery and hide alternative cameras after a failure.
 */
export function installCameraPermissions(window: BrowserWindow, camera: CameraManager, trustedUrl: (url: string) => boolean): void {
  const previousChecks = new Map<string, string>();
  let videoGranted = false;
  window.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const media = details as Electron.MediaAccessPermissionRequest;
    const prepared = camera.hasPermission();
    const allowed = permission === 'media' && webContents === window.webContents && details.isMainFrame
      && trustedUrl(details.requestingUrl) && (prepared || videoGranted)
      && Boolean(media.mediaTypes?.length) && media.mediaTypes!.every((type) => type === 'video');
    if (allowed) videoGranted = true;
    if (permission === 'media') diagnostic('permission.media-request', undefined, { allowed, prepared,
      mainWindow: webContents === window.webContents, isMainFrame: details.isMainFrame,
      requestingUrl: diagnosticUrl(details.requestingUrl), securityOrigin: diagnosticUrl(media.securityOrigin), mediaTypes: media.mediaTypes });
    callback(allowed);
  });
  window.webContents.session.setPermissionCheckHandler((webContents, permission, origin, details) => {
    const prepared = camera.hasPermission();
    const allowed = permission === 'media' && webContents === window.webContents && details.isMainFrame
      && trustedUrl(details.requestingUrl ?? '') && (prepared || videoGranted) && details.mediaType === 'video';
    if (allowed) videoGranted = true;
    if (permission === 'media') {
      const detail = { allowed, prepared, mainWindow: webContents === window.webContents, isMainFrame: details.isMainFrame,
        requestingOrigin: diagnosticUrl(origin), requestingUrl: diagnosticUrl(details.requestingUrl),
        securityOrigin: diagnosticUrl(details.securityOrigin), embeddingOrigin: diagnosticUrl(details.embeddingOrigin), mediaType: details.mediaType };
      const key = `${detail.mainWindow}:${detail.isMainFrame}:${detail.mediaType ?? 'unspecified'}`;
      const state = JSON.stringify(detail);
      if (previousChecks.get(key) !== state) {
        previousChecks.set(key, state);
        diagnostic('permission.media-check', undefined, detail);
      }
    }
    return allowed;
  });
}
