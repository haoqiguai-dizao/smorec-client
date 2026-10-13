import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runHelper, safeUpdatePath, type StagedPackage } from './staged-package';
import type { WindowsInstallResult } from './windows-installer';

/** A native asInvoker helper survives Electron without a console or an elevation request. */
export async function handoffStagedPackage(prepared: StagedPackage, options: {
  currentExecutable: string; busy(): boolean; beforeQuit(): Promise<void>; cancelQuit(): void; quit(): void;
}): Promise<WindowsInstallResult> {
  if (options.busy()) return { status: 'deferred', reason: 'busy' };
  const target = path.dirname(await fs.realpath(options.currentExecutable));
  if (prepared.plan.target !== target || path.basename(options.currentExecutable) !== '小录.exe') {
    return { status: 'deferred', reason: 'invalid-installation' };
  }
  const permission = await runHelper(prepared.helper, 'permission', prepared.planFile).catch(() => 'unknown');
  if (permission === 'unknown') return { status: 'deferred', reason: 'environment-unknown' };
  if (permission !== 'writable') return { status: 'deferred', reason: 'elevation-required' };
  let reserved = false, handedOff = false;
  try {
    await safeUpdatePath(prepared.plan.session, prepared.planFile);
    prepared.plan.parentId = process.pid;
    await fs.writeFile(prepared.planFile, JSON.stringify(prepared.plan));
    prepared.plan.parentStarted = (await runHelper(prepared.helper, 'parent', prepared.planFile)).trim();
    if (!/^\d{17,19}$/.test(prepared.plan.parentStarted)) throw new Error('无法确认更新会话');
    await fs.writeFile(prepared.planFile, JSON.stringify(prepared.plan));
    const ready = path.join(prepared.plan.session, 'ready.json'), commit = path.join(prepared.plan.session, 'commit');
    for (const file of [ready, commit]) { await safeUpdatePath(prepared.plan.session, file); await fs.rm(file, { force: true }); }
    const helper = spawn(prepared.helper, ['apply', prepared.planFile], { detached: true, windowsHide: true, stdio: 'ignore' });
    let failure: Error | undefined;
    helper.on('error', error => { failure = error; });
    helper.unref();
    let acknowledged = false;
    for (let attempt = 0; attempt < 600; attempt++) {
      if (failure) throw failure;
      if (helper.exitCode !== null) throw new Error('更新助手未能就绪');
      try { acknowledged = JSON.parse(await fs.readFile(ready, 'utf8')).parentId === process.pid; } catch { /* awaiting the validated helper */ }
      if (acknowledged) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!acknowledged) throw new Error('更新助手准备超时');
    if (options.busy()) return { status: 'deferred', reason: 'busy' };
    reserved = true; await options.beforeQuit();
    if (options.busy()) return { status: 'deferred', reason: 'busy' };
    await fs.writeFile(commit, 'apply', { flag: 'wx' });
    options.quit();
    handedOff = true;
    return { status: 'handoff-requested' };
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : '更新助手未能启动' };
  } finally { if (reserved && !handedOff) options.cancelQuit(); }
}
