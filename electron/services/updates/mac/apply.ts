import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { UpdateConfiguration } from '../../../../shared/update-types';
import { macReleaseArtifact, parseRelease } from '../manifest';
import { extractBundle, verifyArchive, verifyBundle } from './bundle';
import { launchMacApplication, prepareMacLauncher, terminateMacApplication } from './launch';
import { alive, exists, locations, readJson, readPlan, sleep, writeJson, type MacPlan, type MacJournal } from './paths';

export async function stageMacUpdate(planFile: string, config: UpdateConfiguration, incoming = false): Promise<MacPlan> {
  const plan = await readPlan(planFile);
  plan.release = parseRelease(plan.release, config, 'darwin');
  const files = locations(plan);
  await verifyArchive(files.archive, macReleaseArtifact(plan.release));
  const destination = incoming ? files.incoming : files.stage;
  if (await exists(destination)) throw new Error('Mac 更新暂存目录已存在');
  const bundle = await extractBundle(files.archive, destination, path.basename(plan.target));
  await verifyBundle(bundle, plan.target, plan.release.payload.version);
  return plan;
}
function launch(plan: MacPlan, launcher: string, updated: boolean): Promise<number> {
  return launchMacApplication(plan.target, [
    ...(plan.args ?? []), '--updated', ...(updated ? [`--mac-update-session=${plan.session}`] : []),
  ], launcher);
}
async function restore(plan: MacPlan): Promise<void> {
  const files = locations(plan);
  if (!await exists(files.backup)) return;
  // Preserve a failed candidate for inspection; never remove the only old application copy.
  if (await exists(plan.target)) await fs.rename(plan.target, files.failed);
  await fs.rename(files.backup, plan.target);
}
async function healthy(plan: MacPlan, childId?: number): Promise<boolean> {
  try {
    const health = await readJson<{ version: string; pid: number; session: string }>(locations(plan).health);
    return health.version === plan.release.payload.version && health.session === plan.session
      && (childId === undefined || health.pid === childId) && alive(health.pid);
  } catch { return false; }
}
async function confirmed(plan: MacPlan): Promise<void> {
  const files = locations(plan);
  await writeJson(files.journal, { state: 'confirmed', helperPid: process.pid });
  await fs.rm(files.backup, { recursive: true, force: true });
  await fs.rm(files.incoming, { recursive: true, force: true });
}
export async function applyMacUpdate(planFile: string, config: UpdateConfiguration): Promise<void> {
  const plan = await readPlan(planFile), files = locations(plan);
  if (!plan.parentId || !alive(plan.parentId) || await exists(files.backup) || await exists(files.journal)) throw new Error('Mac 更新会话需要先恢复');
  let moved = false, parentExited = false, childId: number | undefined, launcher: string | undefined;
  try {
    // Rebuild from the signed, hashed ZIP before quitting; a mutated staged .app is never trusted.
    await stageMacUpdate(planFile, config, true);
    launcher = await prepareMacLauncher(files.candidate, plan.session);
    await writeJson(files.journal, { state: 'prepared', helperPid: process.pid, launchMethod: 'workspace' });
    await writeJson(files.ready, { parentId: plan.parentId, helperPid: process.pid });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (await exists(files.commit) && !alive(plan.parentId)) { parentExited = true; break; }
      await sleep(100);
    }
    if (!parentExited) throw new Error('等待确认或旧版退出超时，当前应用未替换');
    await writeJson(files.journal, { state: 'swapping', helperPid: process.pid, launchMethod: 'workspace' });
    await fs.rename(plan.target, files.backup); moved = true;
    await fs.rename(files.candidate, plan.target);
    childId = await launch(plan, launcher, true);
    await writeJson(files.journal, { state: 'launched', helperPid: process.pid, childPid: childId, launchMethod: 'workspace' });
    const healthDeadline = Date.now() + 60_000;
    while (Date.now() < healthDeadline) {
      if (await healthy(plan, childId)) { await confirmed(plan); return; }
      if (!alive(childId)) throw new Error('新版启动失败');
      await sleep(100);
    }
    throw new Error('新版启动确认超时');
  } catch (error) {
    if (childId) await terminateMacApplication(childId);
    if (moved) await restore(plan);
    let restoredPid: number | undefined, relaunchError: string | undefined;
    try { restoredPid = parentExited && launcher ? await launch(plan, launcher, false) : undefined; }
    catch (failure) { relaunchError = failure instanceof Error ? failure.message : String(failure); }
    await writeJson(files.journal, { state: 'rolled-back', helperPid: process.pid, childPid: restoredPid, launchMethod: 'workspace' });
    await writeJson(files.error, { error: error instanceof Error ? error.message : String(error), relaunchError });
    await fs.rm(files.incoming, { recursive: true, force: true });
    throw error;
  }
}
/** Runs before UI startup. A crashed helper's old bundle remains authoritative until health confirmation. */
export async function recoverMacUpdate(planFile: string, config: UpdateConfiguration): Promise<string> {
  const plan = await readPlan(planFile); parseRelease(plan.release, config, 'darwin');
  const files = locations(plan);
  if (!await exists(files.journal)) {
    if (await exists(files.backup)) throw new Error('更新备份缺少日志，保留文件等待修复');
    await fs.rm(files.incoming, { recursive: true, force: true }); return 'idle';
  }
  const journal = await readJson<MacJournal>(files.journal);
  if (alive(journal.helperPid) && journal.helperPid !== process.pid && !['confirmed', 'rolled-back'].includes(journal.state)) return 'active';
  if (journal.state === 'confirmed') {
    await fs.rm(files.backup, { recursive: true, force: true }); return 'confirmed';
  }
  if (journal.state === 'rolled-back') return 'rolled-back';
  if (await healthy(plan, journal.childPid)) { await confirmed(plan); return 'confirmed'; }
  const needsRestore = await exists(files.backup);
  await restore(plan);
  await fs.rm(files.incoming, { recursive: true, force: true });
  await writeJson(files.journal, { state: 'rolled-back', helperPid: process.pid });
  return needsRestore ? 'recovered' : 'rolled-back';
}
