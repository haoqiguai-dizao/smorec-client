import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { WindowsInstallResult } from './windows-installer';
import { alive, bundleForExecutable, locations, readJson, readPlan, sleep, writeJson, type MacPrepared } from './mac/paths';

export async function handoffMacInstall(prepared: MacPrepared, options: {
  executable: string; args: string[]; busy(): boolean; beforeQuit(): Promise<void>; cancelQuit(): void; quit(): void;
}): Promise<WindowsInstallResult> {
  if (options.busy()) return { status: 'deferred', reason: 'busy' };
  let child: ChildProcess | undefined, handedOff = false, reserved = false;
  const files = locations(prepared.plan);
  try {
    if (prepared.plan.target !== bundleForExecutable(options.executable)) return { status: 'deferred', reason: 'invalid-installation' };
    try { await fs.access(path.dirname(prepared.plan.target), fs.constants.W_OK); }
    catch { return { status: 'deferred', reason: 'elevation-required' }; }
    await readPlan(prepared.planFile);
    prepared.plan.parentId = process.pid;
    prepared.plan.args = options.args.filter(arg => /^--(?:user-data-dir|smorec-test-root)=/.test(arg));
    await writeJson(prepared.planFile, prepared.plan);
    child = spawn(options.executable, [prepared.helper, 'apply', prepared.planFile], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, detached: true, stdio: 'ignore',
    });
    let error: Error | undefined; child.on('error', value => { error = value; });
    const deadline = Date.now() + 180_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (error || child.exitCode !== null || child.signalCode !== null) throw error ?? new Error('Mac 更新助手未能就绪');
      const receipt = await readJson<{ parentId: number; helperPid: number }>(files.ready).catch(() => undefined);
      if (receipt?.parentId === process.pid && receipt.helperPid === child.pid) { ready = true; break; }
      await sleep(100);
    }
    if (!ready) throw new Error('Mac 更新准备超时');
    if (options.busy()) return { status: 'deferred', reason: 'busy' };
    reserved = true; await options.beforeQuit();
    if (options.busy()) return { status: 'deferred', reason: 'busy' };
    await fs.writeFile(files.commit, 'apply', { flag: 'wx', mode: 0o600 });
    options.quit(); handedOff = true; child.unref();
    return { status: 'handoff-requested' };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
  } finally {
    if (!handedOff) { child?.kill('SIGTERM'); await fs.rm(files.commit, { force: true }); }
    if (reserved && !handedOff) options.cancelQuit();
  }
}
/** Called only after the real editor and recorder launcher have loaded successfully. */
export async function confirmMacStartup(options: { session?: string; directory: string; executable: string; version: string }): Promise<void> {
  if (!options.session) return;
  const session = path.resolve(options.session);
  if (path.dirname(session) !== await fs.realpath(options.directory)) throw new Error('Mac 更新确认目录无效');
  const plan = await readPlan(path.join(session, 'plan.json'));
  if (plan.target !== bundleForExecutable(options.executable) || plan.release.payload.version !== options.version) throw new Error('Mac 更新确认版本不符');
  const files = locations(plan);
  const journal = await readJson<{ helperPid: number; childPid?: number; state: string }>(files.journal);
  // The launched process may reach startup before the helper records its PID.
  if (!alive(journal.helperPid) || !['swapping', 'launched'].includes(journal.state)
    || journal.childPid !== undefined && journal.childPid !== process.pid) throw new Error('Mac 更新助手会话已失效');
  await writeJson(files.health, { version: options.version, pid: process.pid, session });
}
