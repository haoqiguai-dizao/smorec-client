import type { App } from 'electron';
import { APP_ID, APP_NAME } from '../../shared/brand';

type IdentityApplication = Pick<App, 'getPath' | 'setPath' | 'setName' | 'setAppUserModelId'>;

/** Run before app readiness and the single-instance lock. Preserve explicit profiles too. */
export function initializeApplicationBranding(application: IdentityApplication, platform = process.platform): void {
  // package.name stays frameflow-studio. Snapshot both paths before setName changes
  // Electron's defaults, keeping Chromium preferences/localStorage in their old profile.
  const userData = application.getPath('userData');
  const sessionData = application.getPath('sessionData');
  application.setName(APP_NAME);
  application.setPath('userData', userData);
  application.setPath('sessionData', sessionData);
  if (platform === 'win32') application.setAppUserModelId(APP_ID);
}
