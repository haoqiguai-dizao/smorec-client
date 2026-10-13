import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { inspectWindowsEnvironment, type WindowsEnvironment } from './windows-environment';

export interface VerifiedWindowsInstaller { path: string; sha256: string; size: number }
export interface WindowsInstallRequest {
  installer: VerifiedWindowsInstaller;
  currentExecutable: string;
  resourcesPath: string;
  isPackaged: boolean;
  isBusy(): boolean | undefined;
  /** Permit the normal NSIS/UAC prompt only at an idle startup. Never self-elevate here. */
  allowElevation?: boolean;
}
export type WindowsInstallDeferReason = 'unsupported' | 'busy' | 'state-unknown'
  | 'invalid-installation' | 'installer-unavailable' | 'installer-mismatch'
  | 'environment-unknown' | 'external-resource-in-use' | 'elevation-required' | 'download-changed';
export interface WindowsInstallDeferred { status: 'deferred'; reason: WindowsInstallDeferReason }
export interface WindowsInstallPlan {
  readonly installerPath: string;
  readonly sha256: string;
  readonly size: number;
  readonly installDirectory: string;
  readonly currentExecutable: string;
  readonly resourcesPath: string;
  readonly elevationRequired: boolean;
  readonly allowElevation: boolean;
}
export type WindowsInstallPreparation = { status: 'ready'; plan: WindowsInstallPlan } | WindowsInstallDeferred;

/** The public NsisUpdater API. The owning updater must have completed downloadUpdate(). */
export interface WindowsNsisUpdater {
  installDirectory?: string;
  autoInstallOnAppQuit: boolean;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on?(event: 'error', listener: (error: Error) => void): unknown;
  removeListener?(event: 'error', listener: (error: Error) => void): unknown;
}
export interface WindowsInstallHandoff {
  getDownloadedFile(): string | undefined;
  isBusy(): boolean | undefined;
  /** Reserve startup against new jobs, allow app close, and await all graceful cleanup.
   * Do not call app.quit here: NSIS must be ready before the application exits. */
  beforeQuit(): Promise<void>;
  cancelQuit?(): void;
}
export type WindowsInstallResult = WindowsInstallDeferred
  | { status: 'handoff-requested' } | { status: 'failed'; error: string };
interface FileInfo { size: number; isFile(): boolean; isSymbolicLink(): boolean }
export interface WindowsInstallerDependencies {
  platform: string;
  processId: number;
  realpath(file: string): Promise<string>;
  stat(file: string): Promise<FileInfo>;
  digest(file: string): Promise<string>;
  inspect(directory: string, files: readonly string[]): Promise<WindowsEnvironment>;
}

const defaults: WindowsInstallerDependencies = {
  platform: process.platform, processId: process.pid,
  realpath: file => fs.realpath(file), stat: file => fs.lstat(file),
  async digest(file) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  },
  inspect: inspectWindowsEnvironment,
};
const plans = new WeakSet<WindowsInstallPlan>();
const activeHandoffs = new WeakSet<WindowsNsisUpdater>();
const deferred = (reason: WindowsInstallDeferReason): WindowsInstallDeferred => ({ status: 'deferred', reason });
const samePath = (a: string, b: string) => path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase();
function localPath(value: string): boolean {
  return typeof value === 'string' && value.length <= 1024 && /^[a-z]:[\\/]/i.test(value)
    && !/["<>|?*]/.test(value) && ![...value].some(character => character.charCodeAt(0) < 32)
    && !value.slice(2).includes(':');
}
function inside(directory: string, file: string): boolean {
  const relative = path.win32.relative(directory.toLowerCase(), file.toLowerCase());
  return relative === '' || (!relative.startsWith('..\\') && relative !== '..' && !path.win32.isAbsolute(relative));
}
function idleStatus(isBusy: () => boolean | undefined): WindowsInstallDeferred | undefined {
  try { const busy = isBusy(); return busy === false ? undefined : deferred(busy === true ? 'busy' : 'state-unknown'); }
  catch { return deferred('state-unknown'); }
}
async function artifact(
  installer: VerifiedWindowsInstaller, installDirectory: string, dependencies: WindowsInstallerDependencies,
): Promise<{ path: string } | WindowsInstallDeferred> {
  if (!localPath(installer.path) || !/^[a-f0-9]{64}$/i.test(installer.sha256)
    || !Number.isSafeInteger(installer.size) || installer.size <= 0 || installer.size > 4 * 1024 ** 3) {
    return deferred('installer-mismatch');
  }
  try {
    const info = await dependencies.stat(installer.path);
    const canonical = await dependencies.realpath(installer.path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== installer.size
      || !localPath(canonical) || path.win32.extname(canonical).toLowerCase() !== '.exe'
      || inside(installDirectory, canonical)) return deferred('installer-mismatch');
    if ((await dependencies.digest(canonical)).toLowerCase() !== installer.sha256.toLowerCase()) {
      return deferred('installer-mismatch');
    }
    return { path: canonical };
  } catch { return deferred('installer-unavailable'); }
}
async function environment(
  directory: string, resources: string, allowElevation: boolean, dependencies: WindowsInstallerDependencies,
): Promise<{ elevationRequired: boolean } | WindowsInstallDeferred> {
  const files: string[] = [];
  const camera = path.win32.join(resources, 'virtual-camera', 'XiaoLu.VirtualCamera.dll');
  try {
    const info = await dependencies.stat(camera);
    const canonical = await dependencies.realpath(camera);
    if (!info.isFile() || info.isSymbolicLink() || !samePath(canonical, camera)) return deferred('environment-unknown');
    files.push(canonical);
  } catch (error) {
    // Older installations may not include a virtual camera. Other errors are not absence.
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') return deferred('environment-unknown');
  }
  let result: WindowsEnvironment;
  try { result = await dependencies.inspect(directory, files); }
  catch { return deferred('environment-unknown'); }
  if (result.status !== 'checked' || result.permission === 'unknown') return deferred('environment-unknown');
  // Loaded camera DLLs remain mapped in their consumers while NSIS renames the old files.
  // Ownership is not a sharing violation. NSIS performs atomic rename/rollback for actual file locks.
  // Never terminate another application merely because it enumerated this camera.
  const elevationRequired = result.permission === 'elevation-required';
  if (elevationRequired && !allowElevation) return deferred('elevation-required');
  return { elevationRequired };
}

/** This is preflight, not proof of installation. Re-create the plan on each application launch. */
export async function prepareWindowsInstall(
  request: WindowsInstallRequest, dependencies: WindowsInstallerDependencies = defaults,
): Promise<WindowsInstallPreparation> {
  if (dependencies.platform !== 'win32' || !request.isPackaged) return deferred('unsupported');
  const busy = idleStatus(request.isBusy); if (busy) return busy;
  if (!localPath(request.currentExecutable) || !localPath(request.resourcesPath)) return deferred('invalid-installation');
  let currentExecutable: string, resourcesPath: string;
  try {
    currentExecutable = await dependencies.realpath(request.currentExecutable);
    resourcesPath = await dependencies.realpath(request.resourcesPath);
    const executableInfo = await dependencies.stat(currentExecutable);
    if (!executableInfo.isFile()) return deferred('invalid-installation');
  } catch { return deferred('invalid-installation'); }
  const installDirectory = path.win32.dirname(currentExecutable);
  if (!localPath(currentExecutable) || !localPath(resourcesPath)
    || path.win32.basename(currentExecutable).toLowerCase() !== '小录.exe'
    || samePath(installDirectory, path.win32.parse(installDirectory).root)
    || !samePath(resourcesPath, path.win32.join(installDirectory, 'resources'))) return deferred('invalid-installation');
  const file = await artifact(request.installer, installDirectory, dependencies);
  if ('status' in file) return file;
  const inspected = await environment(installDirectory, resourcesPath, request.allowElevation === true, dependencies);
  if ('status' in inspected) return inspected;
  const changed = idleStatus(request.isBusy); if (changed) return changed;
  const plan = Object.freeze({
    installerPath: file.path, sha256: request.installer.sha256.toLowerCase(), size: request.installer.size,
    currentExecutable, installDirectory, resourcesPath, elevationRequired: inspected.elevationRequired,
    allowElevation: request.allowElevation === true,
  });
  plans.add(plan);
  return { status: 'ready', plan };
}
async function downloadedMatches(
  plan: WindowsInstallPlan, handoff: WindowsInstallHandoff, dependencies: WindowsInstallerDependencies,
): Promise<boolean> {
  try {
    const file = handoff.getDownloadedFile();
    return !!file && localPath(file) && samePath(await dependencies.realpath(file), plan.installerPath);
  } catch { return false; }
}

/** Uses public NSIS apply only. The caller must also disable autoInstallOnAppQuit at updater creation.
 * Keep pending metadata until the new running version confirms installation; listen for updater errors.
 * The final NSIS atomic rename/rollback is the fallback for locks acquired after this preflight. */
export async function handoffWindowsInstall(
  plan: WindowsInstallPlan, updater: WindowsNsisUpdater, handoff: WindowsInstallHandoff,
  dependencies: WindowsInstallerDependencies = defaults,
): Promise<WindowsInstallResult> {
  if (dependencies.platform !== 'win32' || !plans.has(plan)) return deferred('invalid-installation');
  if (activeHandoffs.has(updater)) return deferred('busy');
  activeHandoffs.add(updater);
  let reserved = false;
  let result: WindowsInstallResult;
  try {
    result = await (async (): Promise<WindowsInstallResult> => {
      const busy = idleStatus(handoff.isBusy); if (busy) return busy;
      if (!await downloadedMatches(plan, handoff, dependencies)) return deferred('download-changed');
      const file = await artifact({ path: plan.installerPath, sha256: plan.sha256, size: plan.size },
        plan.installDirectory, dependencies);
      if ('status' in file) return file;
      const inspected = await environment(plan.installDirectory, plan.resourcesPath, plan.allowElevation, dependencies);
      if ('status' in inspected) return inspected;
      const changed = idleStatus(handoff.isBusy); if (changed) return changed;
      reserved = true;
      await handoff.beforeQuit();
      const finalBusy = idleStatus(handoff.isBusy); if (finalBusy) return finalBusy;
      if (!await downloadedMatches(plan, handoff, dependencies)) return deferred('download-changed');
      // Cleanup may take time: recheck package contents and outside consumers before handing off.
      const finalFile = await artifact({ path: plan.installerPath, sha256: plan.sha256, size: plan.size },
        plan.installDirectory, dependencies);
      if ('status' in finalFile) return finalFile;
      const finalEnvironment = await environment(plan.installDirectory, plan.resourcesPath, plan.allowElevation, dependencies);
      if ('status' in finalEnvironment) return finalEnvironment;
      if (!await downloadedMatches(plan, handoff, dependencies)) return deferred('download-changed');
      const lastBusy = idleStatus(handoff.isBusy); if (lastBusy) return lastBusy;
      // No shell command construction: NSIS handles quoting, /S, /D and normal UAC elevation.
      updater.autoInstallOnAppQuit = false;
      updater.installDirectory = plan.installDirectory;
      // BaseUpdater may emit a synchronous error and return void instead of throwing.
      let installError: Error | undefined;
      const onError = (error: Error) => { installError = error; };
      const observable = !!updater.on && !!updater.removeListener;
      if (observable) updater.on!('error', onError);
      try { updater.quitAndInstall(true, true); }
      finally { if (observable) updater.removeListener!('error', onError); }
      if (installError) throw installError;
      return { status: 'handoff-requested' };
    })();
  } catch (error) {
    result = { status: 'failed', error: error instanceof Error ? error.message : 'Windows update handoff failed' };
  }
  if (result.status !== 'handoff-requested') {
    activeHandoffs.delete(updater);
    if (reserved) {
      try { handoff.cancelQuit?.(); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Could not release update startup reservation';
        result = { status: 'failed', error: result.status === 'failed' ? result.error + '; ' + message : message };
      }
    }
  }
  return result;
}
