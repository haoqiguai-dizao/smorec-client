import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SignedRelease } from '../../../../shared/update-types';
import { downloadPackage } from '../package-download';
import { macReleaseArtifact } from '../manifest';
import { verifyArchive } from './bundle';
import { readJson, writeJson, type MacPlan, type MacPrepared } from './paths';

/** Electron's patched fs treats app.asar as a directory; native rm must remove the archive itself. */
async function removeTree(directory: string): Promise<void> {
  const native = process.versions.electron
    ? (createRequire(process.execPath)('original-fs') as typeof import('node:fs')).promises : fs;
  await native.rm(directory, { recursive: true, force: true });
}
export function runMacHelper(executable: string, helper: string, command: string, planFile: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => execFile(executable, [helper, command, planFile], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 180_000, maxBuffer: 96000, signal,
  }, (error, stdout, stderr) => {
    if (!error) { resolve(stdout.trim()); return; }
    // Keep the original command failure for local diagnostics. Only outcome.ts's
    // allowlisted messages may reach the UI; never display arbitrary stderr there.
    const message = /^Error: ([^\r\n]+)$/m.exec(stderr)?.[1] ?? 'Mac 更新助手执行失败';
    reject(new Error(message, { cause: error }));
  }));
}
export async function prepareMacPackage(options: {
  directory: string; target: string; executable: string; helper: string; release: SignedRelease;
  fetch: typeof fetch; signal: AbortSignal; progress(percent: number): void; preparing(): void;
}): Promise<MacPrepared> {
  const artifact = macReleaseArtifact(options.release);
  await fs.mkdir(options.directory, { recursive: true });
  const directory = await fs.realpath(options.directory);
  const cache = path.join(directory, `mac-${artifact.sha256}.zip`);
  try { await verifyArchive(cache, artifact); }
  catch {
    await fs.rm(cache, { force: true });
    const partial = cache + '.part'; await fs.rm(partial, { force: true });
    try {
      await downloadPackage(artifact, partial, options.fetch, options.signal, options.progress);
      await fs.rename(partial, cache);
    } catch (error) { await fs.rm(partial, { force: true }); throw error; }
  }
  options.signal.throwIfAborted(); options.preparing();
  const session = path.join(directory, 'mac-session-' + randomUUID());
  await fs.mkdir(session, { mode: 0o700 });
  const plan: MacPlan = { session, target: options.target, release: options.release };
  const planFile = path.join(session, 'plan.json'), helper = path.join(session, 'mac-update-helper.cjs');
  try {
    await fs.copyFile(cache, path.join(session, 'app-update.zip'));
    await fs.copyFile(options.helper, helper);
    await writeJson(planFile, plan);
    await runMacHelper(options.executable, helper, 'stage', planFile, options.signal);
    await removeTree(path.join(session, 'stage'));
    for (const name of await fs.readdir(directory)) {
      if (/^mac-[a-f0-9]{64}\.zip$/.test(name) && name !== path.basename(cache)) await fs.rm(path.join(directory, name), { force: true });
    }
    return { plan, planFile, helper };
  } catch (error) { await removeTree(session); throw error; }
}
export async function recoverMacPackages(options: { directory: string; target: string; executable: string; helper: string }): Promise<boolean> {
  for (const name of (await fs.readdir(options.directory).catch(() => [])).filter(name => /^mac-session-[a-f0-9-]{36}$/.test(name))) {
    const planFile = path.join(options.directory, name, 'plan.json');
    const plan = await readJson<MacPlan>(planFile);
    if (plan.target !== options.target) continue;
    const result = await runMacHelper(options.executable, options.helper, 'recover', planFile);
    if (result === 'recovered') return true;
    if (result === 'active') continue;
    // The helper has resolved any journal before obsolete staging files are removed.
    await removeTree(path.dirname(planFile));
  }
  return false;
}
