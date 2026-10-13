import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { NsisUpdater } from 'electron-updater';
import type { SignedRelease, UpdateConfiguration, UpdateSnapshot } from '../../../shared/update-types';
import { compareVersions, parseRelease, secureUrl } from './manifest';
import type { WindowsInstallResult } from './windows-installer';
import { prepareMacPackage } from './mac/package';
import type { MacPrepared } from './mac/paths';
import { deferredUpdateMessage, updateFailureMessage } from './outcome';
import { prepareStagedPackage, type StagedPackage } from './staged-package';

interface PreparedUpdate { updater?: NsisUpdater; mac?: MacPrepared; staged?: StagedPackage; release: SignedRelease; file: string; getDownloadedFile(): string }
interface Options {
  directory: string; version: string; config: UpdateConfiguration; packaged: boolean;
  changed(snapshot: UpdateSnapshot): void;
  apply(prepared: PreparedUpdate): Promise<WindowsInstallResult>;
  automaticRelaunch?: boolean;
  installed(version: string): void;
  failed(): void;
  reportError?(error: unknown): void;
  fetch?: typeof fetch;
  packageHelper?: string;
  macHelper?: string;
  installDirectory?: string;
  recover?(): Promise<boolean>;
}
interface Pending { release: SignedRelease; attemptedAt?: number }
class UpdateNetworkUnavailable extends Error {}
export class UpdateManager {
  private state: UpdateSnapshot;
  private operation?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private prepared?: PreparedUpdate;
  private request?: AbortController;
  private updaterFailed = false;
  private consecutiveFailures = 0;
  private downloadCancellation?: { cancel(): void };
  private readonly pendingFile: string;
  private readonly configured: boolean;
  private recoveryBlocked = false;
  constructor(private options: Options) {
    this.pendingFile = path.join(options.directory, 'pending.json');
    this.configured = options.packaged && (process.platform === 'win32' && process.arch === 'x64' || process.platform === 'darwin' && process.arch === 'arm64')
      && Object.keys(options.config.publicKeys).length > 0;
    this.state = { status: this.configured ? 'idle' : 'unconfigured', currentVersion: options.version };
  }
  snapshot(): UpdateSnapshot { return { ...this.state }; }
  private failureMessage(error: unknown): string {
    this.options.reportError?.(error);
    return updateFailureMessage(error);
  }
  private publish(patch: Partial<UpdateSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch }; this.options.changed(this.snapshot());
  }
  private async savePending(value: Pending): Promise<void> {
    if (this.disposed) return;
    await fs.mkdir(this.options.directory, { recursive: true });
    await fs.writeFile(this.pendingFile + '.tmp', JSON.stringify(value), 'utf8');
    await fs.rename(this.pendingFile + '.tmp', this.pendingFile);
  }
  private async pending(): Promise<Pending | undefined> {
    try {
      if ((await fs.stat(this.pendingFile)).size > 64_000) return;
      const value = JSON.parse(await fs.readFile(this.pendingFile, 'utf8')) as Pending;
      value.release = parseRelease(value.release, this.options.config, process.platform === 'darwin' ? 'darwin' : 'win32');
      if (value.attemptedAt !== undefined && !Number.isSafeInteger(value.attemptedAt)) return;
      return value;
    } catch { return; }
  }
  private async latest(): Promise<SignedRelease | undefined> {
    const url = secureUrl(this.options.config.serviceUrl.replace(/\/$/, '') + '/api/updates/latest');
    if (process.platform === 'darwin') { url.searchParams.set('platform', 'darwin'); url.searchParams.set('arch', process.arch); }
    url.searchParams.set('version', this.options.version); url.searchParams.set('channel', this.options.config.channel);
    const controller = this.request = new AbortController();
    try {
      let response: Response;
      try { response = await (this.options.fetch ?? fetch)(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        redirect: 'error', cache: 'no-store' }); }
      catch { throw new UpdateNetworkUnavailable('更新网络暂不可用'); }
      if (response.status >= 500 || response.status === 429) throw new UpdateNetworkUnavailable('更新服务暂不可用');
      if (response.status === 204) return;
      if (!response.ok || !response.body) throw new Error('更新服务暂不可用');
      const reader = response.body.getReader(); let body = '';
      try {
        const decoder = new TextDecoder();
        while (true) {
          const part = await reader.read(); if (part.done) break;
          body += decoder.decode(part.value, { stream: true });
          if (body.length > 64_000) throw new Error('更新清单过大');
        }
        body += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      const release = parseRelease(JSON.parse(body), this.options.config, process.platform === 'darwin' ? 'darwin' : 'win32');
      return compareVersions(release.payload.version, this.options.version) > 0 ? release : undefined;
    } finally { if (this.request === controller) this.request = undefined; }
  }
  private async prepare(release: SignedRelease): Promise<PreparedUpdate> {
    if (process.platform === 'darwin') {
      if (!this.options.macHelper || !this.options.installDirectory) throw new Error('Mac 更新组件不可用');
      const controller = new AbortController(); this.downloadCancellation = { cancel: () => controller.abort() };
      this.publish({ status: 'downloading', version: release.payload.version, releaseNotes: release.payload.releaseNotes, progress: 0, error: undefined });
      try {
        const mac = await prepareMacPackage({ directory: this.options.directory, target: this.options.installDirectory,
          executable: process.execPath, helper: this.options.macHelper, release, fetch: this.options.fetch ?? fetch,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]),
          progress: progress => this.publish({ progress }), preparing: () => this.publish({ status: 'preparing', progress: 100 }) });
        if (this.disposed) throw new Error('更新已停止');
        const file = path.join(mac.plan.session, 'app-update.zip');
        const prepared = { mac, release, file, getDownloadedFile: () => file };
        this.prepared = prepared; await this.savePending({ release }); this.publish({ status: 'ready', progress: 100 }); return prepared;
      } finally { this.downloadCancellation = undefined; }
    }
    if (process.platform === 'win32' && release.payload.appUpdate) {
      if (!this.options.packageHelper || !this.options.installDirectory) throw new Error('应用更新组件不可用');
      const controller = new AbortController();
      this.downloadCancellation = { cancel: () => controller.abort() };
      this.publish({ status: 'downloading', version: release.payload.version, releaseNotes: release.payload.releaseNotes, progress: 0, error: undefined });
      try {
        const staged = await prepareStagedPackage({ directory: this.options.directory, release,
          helper: this.options.packageHelper, target: this.options.installDirectory, fetch: this.options.fetch ?? fetch,
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60_000)]),
          progress: progress => this.publish({ progress }), preparing: () => this.publish({ status: 'preparing', progress: 100 }) });
        if (this.disposed) throw new Error('更新已停止');
        const prepared = { release, staged, file: staged.plan.package, getDownloadedFile: () => staged.plan.package };
        this.prepared = prepared; await this.savePending({ release });
        this.publish({ status: 'ready', progress: 100 }); return prepared;
      } finally { this.downloadCancellation = undefined; }
    }
    if (process.platform !== 'win32') throw new Error('此平台不支持 Windows 安装器更新');
    const { NsisUpdater } = await import('electron-updater');
    const { signedProvider } = await import('./signed-provider');
    // One updater instance owns exactly one signed version and its cache handoff.
    const updater = new NsisUpdater({ provider: 'custom', updateProvider: signedProvider(release) });
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false; updater.allowPrerelease = this.options.config.channel === 'beta';
    if (updater instanceof NsisUpdater) updater.disableWebInstaller = true; updater.disableDifferentialDownload = true;
    updater.logger = null;
    let downloadedFile = '';
    this.updaterFailed = false;
    updater.on('error', error => {
      if (this.disposed) return;
      this.updaterFailed = true; this.options.failed();
      this.publish({ status: 'error', error: this.failureMessage(error) });
    });
    updater.on('download-progress', progress => this.publish({ progress: Math.floor(progress.percent) }));
    updater.on('update-downloaded', event => { downloadedFile = event.downloadedFile; });
    const result = await updater.checkForUpdates();
    if (this.disposed) { result?.cancellationToken?.cancel(); throw new Error('更新已停止'); }
    if (!result || !result.cancellationToken || result.updateInfo.version !== release.payload.version) throw new Error('更新版本已变化');
    this.publish({ status: 'downloading', version: release.payload.version, releaseNotes: release.payload.releaseNotes, progress: 0, error: undefined });
    this.downloadCancellation = result.cancellationToken;
    let files: string[];
    try { files = await updater.downloadUpdate(result.cancellationToken); }
    finally { if (this.downloadCancellation === result.cancellationToken) this.downloadCancellation = undefined; }
    if (this.disposed) throw new Error('更新已停止');
    if (!downloadedFile || files.length !== 1 || files[0] !== downloadedFile) throw new Error('更新文件尚未就绪');
    const prepared: PreparedUpdate = { updater,
      release, file: downloadedFile, getDownloadedFile: () => downloadedFile };
    this.prepared = prepared;
    await this.savePending({ release });
    this.publish({ status: 'ready', progress: 100 });
    return prepared;
  }
  /** Called once before any editor/recorder window is opened. Never called mid-session. */
  async installPendingOnStartup(): Promise<boolean> {
    if (!this.configured) return false;
    try { if (await this.options.recover?.()) return true; }
    catch (error) {
      this.options.reportError?.(error);
      this.recoveryBlocked = true;
      this.publish({ status: 'deferred', manualDownload: true, error: '上次更新恢复未完成，请从官网修复安装' }); return false;
    }
    const pending = await this.pending();
    if (!pending) return false;
    if (compareVersions(pending.release.payload.version, this.options.version) <= 0) {
      if (pending.release.payload.version === this.options.version) this.options.installed(this.options.version);
      await fs.rm(this.pendingFile, { force: true }); return false;
    }
    // Suppress only an installer's automatic relaunch of the unchanged version.
    // A normal user launch retries immediately, including after a preflight deferral.
    if (pending.attemptedAt && this.options.automaticRelaunch) {
      this.publish({ status: 'deferred', version: pending.release.payload.version, error: '上次安装未完成，重启小录后重试' });
      return false;
    }
    try {
      this.publish({ status: 'checking', error: undefined });
      let latest: SignedRelease | undefined;
      try { latest = await this.latest(); }
      catch (error) {
        if (!(error instanceof UpdateNetworkUnavailable) || this.disposed) throw error;
        // A cached package still needs its trusted signature and NSIS size/digest checks.
        latest = pending.release;
      }
      if (!latest) { await fs.rm(this.pendingFile, { force: true }); this.publish({ status: 'idle' }); return false; }
      const prepared = await this.prepare(latest);
      await this.savePending({ release: latest, attemptedAt: Date.now() });
      const outcome = await this.options.apply(prepared);
      if (outcome.status === 'handoff-requested' && !this.updaterFailed) {
        this.publish({ status: 'installing', error: undefined }); return true;
      }
      if (outcome.status === 'deferred') await this.savePending({ release: latest });
      this.publish({ status: 'deferred', manualDownload: outcome.status === 'deferred' && outcome.reason === 'elevation-required',
        error: deferredUpdateMessage(outcome) || '安装未完成，重启小录后重试' });
      return false;
    } catch (error) { this.publish({ status: 'error', error: this.failureMessage(error) }); return false; }
  }
  check(): Promise<void> {
    if (!this.configured || this.disposed || this.recoveryBlocked) return Promise.resolve();
    if (this.operation) return this.operation;
    const previous = this.snapshot();
    const operation = (async () => {
      this.publish({ status: 'checking', error: undefined, manualDownload: false });
      try {
        const release = await this.latest();
        if (this.disposed) return;
        if (!release) { this.prepared = undefined; await fs.rm(this.pendingFile, { force: true });
          this.publish({ status: 'idle', version: undefined, releaseNotes: undefined, progress: undefined }); return; }
        if (this.prepared?.release.signature === release.signature) { this.publish({ status: previous.status === 'deferred' ? 'deferred' : 'ready', error: previous.error }); return; }
        const pending = await this.pending();
        await this.prepare(release);
        if (pending?.release.signature === release.signature && pending.attemptedAt) {
          await this.savePending({ release, attemptedAt: pending.attemptedAt });
          this.publish({ status: 'deferred', error: '上次安装未完成，重启小录后重试' });
        }
    } catch (error) { if (!this.disposed) this.publish({ status: 'error', error: this.failureMessage(error) }); }
    })();
    this.operation = operation;
    return operation.finally(() => { if (this.operation === operation) this.operation = undefined; });
  }
  async prepareRestart(): Promise<void> {
    await this.operation;
    const pending = await this.pending();
    if (!pending || this.recoveryBlocked || this.state.manualDownload || !['ready', 'deferred'].includes(this.state.status)) throw new Error('更新尚未就绪');
    await this.savePending({ release: pending.release });
  }
  start(): void {
    if (!this.configured || this.disposed || this.timer) return;
    const tick = () => { void this.check().finally(() => {
      if (!this.disposed) {
        this.consecutiveFailures = this.state.status === 'error' ? this.consecutiveFailures + 1 : 0;
        const delay = this.consecutiveFailures ? Math.min(30_000 * 2 ** Math.min(this.consecutiveFailures - 1, 5), 10 * 60_000)
          : 4 * 60 * 60_000;
        this.timer = setTimeout(tick, delay + Math.random() * (this.consecutiveFailures ? 5000 : 10 * 60_000));
        this.timer.unref();
      }
    }); };
    this.timer = setTimeout(tick, 20_000); this.timer.unref();
  }
  async stop(): Promise<void> {
    this.disposed = true; clearTimeout(this.timer); this.request?.abort(); this.downloadCancellation?.cancel();
    await this.operation?.catch(() => {});
  }
}
