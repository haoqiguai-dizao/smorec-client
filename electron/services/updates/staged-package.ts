import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { SignedRelease } from '../../../shared/update-types';
import { downloadPackage } from './package-download';
import { compareVersions } from './manifest';

// Update archives are physical files, never Electron's virtual ASAR directories.
const fs = process.versions.electron
  ? (createRequire(process.execPath)('original-fs') as typeof import('node:fs')).promises : nodeFs;

export interface StagedPlan {
  session: string; package: string; staged: string; target: string; version: string;
  size: number; sha256: string; sha512: string; parentId?: number; parentStarted?: string;
}
export interface StagedPackage { plan: StagedPlan; planFile: string; helper: string }
export async function runHelper(helper: string, command: string, plan: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => execFile(helper, [command, plan],
    { windowsHide: true, timeout: 180_000, maxBuffer: 64_000, encoding: 'utf8', signal },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim())));
}
export async function safeUpdatePath(root: string, file: string): Promise<void> {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('更新目录越界');
  for (let current = file; ; current = path.dirname(current)) {
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || (await fs.realpath(current)).toLowerCase() !== path.resolve(current).toLowerCase()) {
        throw new Error('更新目录不能包含链接');
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current === path.dirname(current)) break;
  }
}
async function readSession(directory: string, session: unknown): Promise<StagedPackage | undefined> {
  try {
    if (typeof session !== 'string' || !/^session-[a-f0-9-]{36}$/.test(session)) return;
    const root = path.join(directory, session), planFile = path.join(root, 'plan.json');
    await safeUpdatePath(directory, planFile);
    if ((await fs.stat(planFile)).size > 16000) return;
    const plan = JSON.parse(await fs.readFile(planFile, 'utf8')) as StagedPlan;
    if (plan.session !== root || plan.staged !== path.join(root, 'staged') || plan.package !== path.join(root, 'app-update.zip')) return;
    const helper = path.join(root, 'XiaoLu.Updater.exe'); await safeUpdatePath(root, helper);
    return { plan, planFile, helper };
  } catch { return; }
}
export async function readStagedPackage(directory: string): Promise<StagedPackage | undefined> {
  try {
    const pointer = path.join(directory, 'staged.json'); await safeUpdatePath(directory, pointer);
    if ((await fs.stat(pointer)).size > 2000) return;
    return await readSession(directory, JSON.parse(await fs.readFile(pointer, 'utf8')).session);
  } catch { return; }
}
async function discardSession(directory: string, session: string): Promise<void> {
  if (!/^session-[a-f0-9-]{36}$/.test(path.basename(session))) throw new Error('更新缓存目录无效');
  await safeUpdatePath(directory, session);
  const queue = [session]; let count = 0;
  while (queue.length) {
    const folder = queue.pop()!;
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (++count > 30000 || entry.isSymbolicLink()) throw new Error('更新缓存目录异常');
      if (entry.isDirectory()) queue.push(path.join(folder, entry.name));
    }
  }
  // Keep the plan until cleanup succeeds, so a locked cache can be retried next startup.
  for (const entry of await fs.readdir(session)) {
    if (entry !== 'plan.json') await fs.rm(path.join(session, entry), { recursive: true, force: true });
  }
  await fs.rm(path.join(session, 'plan.json'), { force: true });
  await fs.rmdir(session);
}
/** Recover journals before clearing pending metadata. Cleanup only this updater's bounded sessions. */
export async function recoverStagedPackages(directory: string, target: string, version: string, helper: string): Promise<boolean> {
  const names = await fs.readdir(directory).catch(() => []);
  for (const name of names.filter(name => /^session-[a-f0-9-]{36}$/.test(name)).slice(0, 40)) {
    const cached = await readSession(directory, name);
    if (!cached || cached.plan.target !== target) continue;
    const result = await runHelper(helper, 'recover', cached.planFile);
    if (result === 'recovered') return true;
    if (result === 'active') continue;
    if (compareVersions(cached.plan.version, version) <= 0
      && !await fs.access(path.join(cached.plan.session, 'journal.json')).then(() => true, () => false)) {
      try { await discardSession(directory, cached.plan.session); }
      catch (error) {
        // Recovery already succeeded. A busy cache is housekeeping, not installation damage.
        if (!['EBUSY', 'EACCES', 'EPERM', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }
  }
  return false;
}
export async function prepareStagedPackage(options: {
  directory: string; target: string; helper: string; release: SignedRelease; fetch: typeof fetch; signal: AbortSignal;
  progress(percent: number): void; preparing(): void;
}): Promise<StagedPackage> {
  const artifact = options.release.payload.appUpdate;
  if (!artifact) throw new Error('该版本没有应用更新包');
  const cached = await readStagedPackage(options.directory);
  if (cached && cached.plan.sha256 === artifact.sha256 && cached.plan.sha512 === artifact.sha512
    && cached.plan.size === artifact.size && cached.plan.version === options.release.payload.version && cached.plan.target === options.target) {
    options.preparing();
    try {
      await runHelper(options.helper, 'verify', cached.planFile, options.signal);
      await fs.copyFile(options.helper, cached.helper);
      return cached;
    }
    catch { options.signal.throwIfAborted(); }
  }
  const session = path.join(options.directory, 'session-' + randomUUID());
  await safeUpdatePath(options.directory, session); await fs.mkdir(session, { recursive: true });
  const helper = path.join(session, 'XiaoLu.Updater.exe');
  await fs.copyFile(options.helper, helper, fs.constants.COPYFILE_EXCL);
  const plan: StagedPlan = { session, package: path.join(session, 'app-update.zip'), staged: path.join(session, 'staged'),
    target: options.target, version: options.release.payload.version, size: artifact.size, sha256: artifact.sha256, sha512: artifact.sha512 };
  const planFile = path.join(session, 'plan.json');
  await fs.writeFile(planFile, JSON.stringify(plan), { flag: 'wx' });
  try {
  await downloadPackage(artifact, plan.package, options.fetch, options.signal, options.progress);
  options.preparing(); await runHelper(helper, 'stage', planFile, options.signal);
  options.signal.throwIfAborted();
  const pointer = path.join(options.directory, 'staged.json'); await safeUpdatePath(options.directory, pointer);
  await fs.writeFile(pointer + '.tmp', JSON.stringify({ session: path.basename(session) }));
  await fs.rename(pointer + '.tmp', pointer);
  return { plan, planFile, helper };
  } catch (error) {
    await discardSession(options.directory, session).catch(() => {});
    throw error;
  }
}
