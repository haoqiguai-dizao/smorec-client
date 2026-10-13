import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SignedRelease } from '../../../../shared/update-types';

export interface MacPlan {
  session: string; target: string; release: SignedRelease;
  parentId?: number; args?: string[];
}
export interface MacPrepared { plan: MacPlan; planFile: string; helper: string }
export interface MacJournal { state: 'prepared' | 'swapping' | 'launched' | 'confirmed' | 'rolled-back'; helperPid: number; childPid?: number; launchMethod?: 'workspace' }
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function exists(file: string): Promise<boolean> { return fs.lstat(file).then(() => true, () => false); }
export function bundleForExecutable(executable: string): string {
  const target = path.resolve(executable, '../../..');
  if (!target.endsWith('.app') || path.dirname(executable) !== path.join(target, 'Contents', 'MacOS')) throw new Error('当前程序不在 Mac 应用包内');
  return target;
}
export async function regularPath(file: string, directory = false): Promise<void> {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
    || await fs.realpath(file) !== path.resolve(file)) throw new Error('更新路径包含链接或类型无效');
}
export async function readJson<T>(file: string): Promise<T> {
  await regularPath(file);
  if ((await fs.stat(file)).size > 96_000) throw new Error('更新记录过大');
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}
export async function writeJson(file: string, value: unknown): Promise<void> {
  const temporary = file + '.tmp';
  await fs.rm(temporary, { force: true });
  const handle = await fs.open(temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, file);
}
export async function readPlan(file: string): Promise<MacPlan> {
  const plan = await readJson<MacPlan>(file);
  if (plan.session !== path.dirname(file) || !/^mac-session-[a-f0-9-]{36}$/.test(path.basename(plan.session))
    || path.basename(file) !== 'plan.json' || typeof plan.target !== 'string'
    || plan.target !== path.resolve(plan.target) || !path.isAbsolute(plan.target) || !plan.target.endsWith('.app') || plan.target.startsWith('/Volumes/')) throw new Error('Mac 更新会话无效');
  await regularPath(plan.session, true);
  await regularPath(path.dirname(plan.target), true);
  if (plan.parentId !== undefined && (!Number.isSafeInteger(plan.parentId) || plan.parentId < 2)) throw new Error('更新父进程无效');
  if (plan.args !== undefined && (!Array.isArray(plan.args) || plan.args.some(arg => typeof arg !== 'string'
    || !/^--(?:user-data-dir|smorec-test-root)=.{1,4096}$/.test(arg)))) throw new Error('更新重启参数无效');
  return plan;
}
export function locations(plan: MacPlan) {
  const id = path.basename(plan.session).slice('mac-session-'.length);
  const incoming = path.join(path.dirname(plan.target), `.xiaolu-incoming-${id}`);
  return { archive: path.join(plan.session, 'app-update.zip'), stage: path.join(plan.session, 'stage'),
    incoming, candidate: path.join(incoming, path.basename(plan.target)),
    failed: path.join(path.dirname(plan.target), `.xiaolu-failed-${id}.app`),
    backup: path.join(path.dirname(plan.target), `.xiaolu-previous-${id}.app`),
    journal: path.join(plan.session, 'journal.json'), ready: path.join(plan.session, 'ready.json'),
    commit: path.join(plan.session, 'commit'), health: path.join(plan.session, 'health.json'), error: path.join(plan.session, 'error.json') };
}
export function alive(pid: number | undefined): boolean {
  if (!pid || pid < 2) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
