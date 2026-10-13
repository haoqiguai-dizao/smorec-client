import type { BrowserWindow } from 'electron';

// Native SourceCatalog uses this title together with parent process ownership.
export const CAMERA_PREVIEW_TITLE = '小录摄像头';
const independent = new WeakSet<BrowserWindow>();
let prepareCapture: (() => Promise<void>) | undefined;
export const isIndependentCameraWindow = (window: BrowserWindow): boolean => independent.has(window);
export const capturedDemoCamera = (platform: string, cameraIndependent?: boolean): 'independent' | undefined =>
  platform === 'win32' || cameraIndependent === true ? 'independent' : undefined;

/** New/reloaded previews await the active Mac filter before their first local display. */
export function bindCameraCapturePreparation(prepare: () => Promise<void>): () => void {
  prepareCapture = prepare;
  return () => { if (prepareCapture === prepare) prepareCapture = undefined; };
}
export async function prepareIndependentCamera(window: BrowserWindow, platform = process.platform): Promise<void> {
  if (platform === 'darwin' && independent.has(window)) await prepareCapture?.();
}

/** Keep the preview local. The output receives the separately recorded camera track. */
export function protectIndependentCamera(window: BrowserWindow, platform = process.platform): void {
  independent.add(window);
  window.setTitle(CAMERA_PREVIEW_TITLE);
  window.on('page-title-updated', event => event.preventDefault());
  if (platform === 'win32') window.setContentProtection(true);
}
