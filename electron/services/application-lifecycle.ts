import { app } from 'electron';

interface Lifecycle {
  ready(): boolean; wake(): void; allowClose(): boolean; shutdown(): Promise<void>;
  initialize(): Promise<void>; failed(error: unknown): void; dispose(): void;
}
/** Keep single-instance, startup and shutdown ordering outside the business entry's composition. */
export function installApplicationLifecycle(options: Lifecycle) {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  // macOS keeps the process alive while the permission page hands off to the workspace.
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('second-instance', () => { if (options.ready()) options.wake(); });
  app.on('before-quit', event => { if (!options.allowClose()) { event.preventDefault(); void options.shutdown(); } });
  app.whenReady().then(options.initialize).catch(options.failed);
  app.on('will-quit', options.dispose);
}
