import { app, ipcMain, Notification, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import { electronFetch } from './updates/electron-fetch';
import { promises as fs } from 'node:fs';
import config from '../../config/distribution.json';
import type { DistributionSnapshot } from '../../shared/distribution-types';
import type { UpdateConfiguration } from '../../shared/update-types';
import { createTelemetry } from './telemetry';
import { handoffMacInstall, confirmMacStartup } from './updates/mac-install';
import { recoverMacPackages } from './updates/mac/package';
import { bundleForExecutable } from './updates/mac/paths';
import { confirmSystemMacStartup } from './updates/mac/legacy-launch';
import { UpdateManager } from './updates/manager';
import { prepareWindowsInstall, handoffWindowsInstall } from './updates/windows-installer';
import { handoffStagedPackage } from './updates/staged-handoff';
import { recoverStagedPackages } from './updates/staged-package';
import { diagnostic } from './diagnostics';

interface Options {
  window(): BrowserWindow | undefined; trusted(event: Electron.IpcMainInvokeEvent): boolean;
  busy(): boolean; restart(): Promise<void>; beforeUpdateQuit(): Promise<void>; cancelUpdateQuit(): void;
}
export function createDistribution(options: Options) {
  const directory = path.join(app.getPath('userData'), 'distribution');
  const configuration = config as UpdateConfiguration;
  const fetcher = electronFetch;
  const telemetryEndpoint = configuration.serviceUrl.replace(/\/+$/, '') + '/api/events/batch';
  const telemetry = createTelemetry({ directory: path.join(directory, 'telemetry'), endpoint: telemetryEndpoint, fetch: fetcher,
    version: app.getVersion(), channel: configuration.channel, platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux', packaged: app.isPackaged && !app.commandLine.hasSwitch('smorec-test-root') });
  async function trackInstallation() {
    if (!app.isPackaged || !telemetry.preferences().enabled) return;
    try {
      const file = path.join(path.dirname(process.execPath), 'installation-receipt.json');
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return;
      const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
      if (receipt.version === app.getVersion()) telemetry.trackInstallationReceipt(receipt);
    } catch { /* Older/manual installations have no installation success receipt. */ }
  }
  let installedVersion: string | undefined;
  const packageHelper = path.join(process.resourcesPath ?? path.join(path.dirname(process.execPath), 'resources'), 'updater', 'XiaoLu.Updater.exe');
  const macHelper = path.join(__dirname, 'mac-update-helper.cjs');
  const macTarget = process.platform === 'darwin' && app.isPackaged ? bundleForExecutable(process.execPath) : '';
  let notifiedVersion: string | undefined, started = false;
  const publish = () => {
    const target = options.window();
    if (target && !target.isDestroyed()) target.webContents.send('distribution:changed', snapshot());
    const update = updater.snapshot();
    if (started && update.status === 'ready' && update.version !== notifiedVersion && !options.busy() && app.isPackaged && Notification?.isSupported()) {
      notifiedVersion = update.version;
      const notification = new Notification({ title: '小录更新已准备好', body: `${update.version} 已下载，点击重启完成更新`, silent: true });
      notification.once('click', () => {
        if (!options.busy()) void restartUpdate().catch(() => {});
      });
      notification.show();
    }
  };
  const updater = new UpdateManager({ directory: path.join(directory, 'updates'), version: app.getVersion(), config: configuration,
    reportError: error => diagnostic('update.failed', error, {
      cause: error instanceof Error && error.cause instanceof Error ? error.cause.stack?.slice(0, 6000) : undefined,
    }),
    packageHelper, macHelper, installDirectory: macTarget || path.dirname(process.execPath),
    recover: async () => {
      if (process.platform === 'darwin') {
        if (!await recoverMacPackages({ directory: path.join(directory, 'updates'), target: macTarget, executable: process.execPath, helper: macHelper })) return false;
        app.relaunch({ args: [...process.argv.slice(1).filter(arg => !arg.startsWith('--mac-update-session=')
          && !arg.startsWith('--mac-update-system-session=') && arg !== '--updated'), '--updated'] });
        app.exit(0); return true;
      }
      if (process.platform !== 'win32') return false;
      if (!await recoverStagedPackages(path.join(directory, 'updates'), path.dirname(process.execPath), app.getVersion(), packageHelper)) return false;
      app.relaunch(); app.exit(0); return true;
    },
    packaged: app.isPackaged && !app.commandLine.hasSwitch('smorec-test-root'), automaticRelaunch: app.commandLine.hasSwitch('updated'), changed: publish, installed: version => { installedVersion = version; }, failed: options.cancelUpdateQuit, fetch: fetcher,
    apply: async prepared => {
      if (prepared.mac) return handoffMacInstall(prepared.mac, { executable: process.execPath, args: process.argv,
        busy: options.busy, beforeQuit: options.beforeUpdateQuit, cancelQuit: options.cancelUpdateQuit, quit: () => app.quit() });
      if (prepared.staged) return handoffStagedPackage(prepared.staged, { currentExecutable: process.execPath,
        busy: options.busy, beforeQuit: options.beforeUpdateQuit, cancelQuit: options.cancelUpdateQuit, quit: () => app.quit() });
      if (!prepared.updater) return { status: 'deferred', reason: 'installer-unavailable' };
      const artifact = prepared.release.payload.artifacts[0];
      const result = await prepareWindowsInstall({ installer: { path: prepared.file, sha256: artifact.sha256, size: artifact.size },
        currentExecutable: process.execPath, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged,
        isBusy: options.busy, allowElevation: false });
      if (result.status !== 'ready') return result;
      const handoff = await handoffWindowsInstall(result.plan, prepared.updater, {
        getDownloadedFile: prepared.getDownloadedFile, isBusy: options.busy,
        beforeQuit: options.beforeUpdateQuit, cancelQuit: options.cancelUpdateQuit });
      return handoff;
    } });
  async function restartUpdate(): Promise<void> {
    if (options.busy()) throw new Error('请先结束录制、投屏或导出，再重启更新');
    await updater.prepareRestart();
    if (options.busy()) throw new Error('请先结束录制、投屏或导出，再重启更新');
    await options.restart();
  }
  function snapshot(): DistributionSnapshot { return { update: updater.snapshot(), telemetry: telemetry.preferences() }; }
  let recordingSince: number | undefined, liveSince: number | undefined;
  function activity(kind: 'recording' | 'live', status: string): void {
    const current = kind === 'recording' ? recordingSince : liveSince;
    if (status === kind && current === undefined) {
      if (kind === 'recording') recordingSince = Date.now(); else liveSince = Date.now();
      telemetry.track(kind === 'recording' ? 'recording_start' : 'live_start');
    } else if (current !== undefined && ['idle', 'error'].includes(status)) {
      telemetry.track(kind === 'recording' ? 'recording_end' : 'live_end', {
        duration_ms: Math.max(0, Date.now() - current), outcome: status === 'error' ? 'failure' : 'success',
        error_code: status === 'error' ? 'capture_failed' : 'none' });
      publish();
      if (kind === 'recording') recordingSince = undefined; else liveSince = undefined;
    }
  }
  let startupConfirmation: Promise<void> | undefined;
  function confirmStartup(): Promise<void> {
    return startupConfirmation ??= (async () => {
      if (process.platform !== 'darwin') return;
      const systemSession = app.commandLine.getSwitchValue('mac-update-system-session');
      const options = { directory: path.join(directory, 'updates'), executable: process.execPath, version: app.getVersion() };
      if (systemSession) await confirmSystemMacStartup({ ...options, session: systemSession });
      else await confirmMacStartup({ ...options, session: app.commandLine.getSwitchValue('mac-update-session') });
    })();
  }
  return {
    activity, telemetry, updater, confirmStartup,
    installIpc() {
      for (const [name, count, callback] of [
        ['state', 0, () => snapshot()], ['check', 0, () => updater.check()],
        ['restart', 0, restartUpdate],
        ['download', 0, () => shell.openExternal(configuration.serviceUrl.replace(/\/+$/, '') + '/')],
        ['licenses', 0, async () => {
          const directory = app.isPackaged ? path.join(process.resourcesPath, 'legal') : path.join(app.getAppPath(), 'docs/open-source/public');
          const error = await shell.openPath(directory);
          if (error) throw new Error('无法打开第三方许可目录');
        }],
        ['telemetry', 1, async (enabled: unknown) => {
          if (typeof enabled !== 'boolean') throw new Error('统计设置无效');
          await telemetry.setEnabled(enabled); await trackInstallation(); publish(); return snapshot();
        }],
      ] as const) ipcMain.handle('distribution:' + name, (_event, ...args: unknown[]) => {
        if (!options.trusted(_event) || args.length !== count) throw new Error('应用设置请求来源无效');
        return callback(args[0]);
      });
    },
    async start() {
      await confirmStartup();
      await telemetry.start();
      started = true;
      await trackInstallation();
      if (installedVersion) telemetry.track('update_result', { outcome: 'success', target_version: installedVersion });
      updater.start(); publish();
    },
    async stop() { await updater.stop(); await telemetry.stop(); },
  };
}
