import { app } from 'electron';
import { bridgeLegacyMacLaunch } from './services/updates/mac/legacy-launch';
import { initializeApplicationBranding } from './services/app-branding';
import { configureCaptureRuntime } from './services/capture-runtime-configuration';
import './services/protocol';

// Handle a legacy updater before importing the UI, recorder or camera services.
initializeApplicationBranding(app);
configureCaptureRuntime(app);
if (process.platform === 'darwin' && app.isPackaged && app.commandLine.hasSwitch('mac-update-session')) {
  void bridgeLegacyMacLaunch(app).then(async bridged => {
    if (!bridged) await import('./main');
  }).catch(error => { console.error('小录更新启动失败', error); app.exit(1); });
} else void import('./main').catch(error => { console.error('小录启动失败', error); app.exit(1); });
