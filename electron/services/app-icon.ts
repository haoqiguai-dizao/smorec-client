import { app, nativeImage, type NativeImage } from 'electron';
import path from 'node:path';

/** Installer resources and all native windows use the same application artwork. */
export function applicationIcon(): NativeImage | undefined {
  const filename = app.isPackaged ? path.join(process.resourcesPath, 'assets', process.platform === 'darwin' ? 'icon.png' : 'icon.ico')
    : process.platform === 'darwin' ? path.join(app.getAppPath(), 'sites', 'website', 'assets', 'xiaolu-icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.ico');
  const image = nativeImage.createFromPath(filename);
  return image.isEmpty() ? undefined : image;
}
