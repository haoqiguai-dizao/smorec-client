import type { App } from 'electron';
import path from 'node:path';
import config from '../../../../config/distribution.json';
import type { UpdateConfiguration } from '../../../../shared/update-types';
import { parseRelease } from '../manifest';
import { launchMacApplication, terminateMacApplication } from './launch';
import { alive, bundleForExecutable, locations, readJson, readPlan, sleep, writeJson, type MacJournal, type MacPlan } from './paths';

interface LaunchReceipt { supervisorPid: number; applicationPid: number; target: string }
interface Health { version: string; pid: number; session: string }
const receiptFile = (plan: MacPlan) => path.join(plan.session, 'workspace-launch.json');
const healthFile = (plan: MacPlan) => path.join(plan.session, 'workspace-health.json');

async function validatedPlan(application: App, session: string): Promise<MacPlan> {
  const directory = path.join(application.getPath('userData'), 'distribution', 'updates');
  const plan = await readPlan(path.join(path.resolve(session), 'plan.json'));
  parseRelease(plan.release, config as UpdateConfiguration, 'darwin');
  if (path.dirname(plan.session) !== directory || plan.target !== bundleForExecutable(process.execPath)
    || plan.release.payload.version !== application.getVersion()) throw new Error('Mac 更新启动会话无效');
  return plan;
}

/** Old clients carry their own old updater. Keep its expected child alive until
 * the independently launched real UI reports healthy and the old updater commits.
 * This process never initializes media or requests privacy access.
 */
export async function bridgeLegacyMacLaunch(application: App): Promise<boolean> {
  const session = application.commandLine.getSwitchValue('mac-update-session');
  if (process.platform !== 'darwin' || !application.isPackaged || !session) return false;
  const plan = await validatedPlan(application, session), files = locations(plan);
  const journal = await readJson<MacJournal>(files.journal);
  if (journal.launchMethod === 'workspace') return false;
  if (!alive(journal.helperPid) || !['swapping', 'launched'].includes(journal.state)
    || journal.childPid !== undefined && journal.childPid !== process.pid) throw new Error('Mac 更新助手会话已失效');
  let pid: number | undefined;
  try {
    pid = await launchMacApplication(plan.target, [...(plan.args ?? []), '--updated', `--mac-update-system-session=${plan.session}`]);
    await writeJson(receiptFile(plan), { supervisorPid: process.pid, applicationPid: pid, target: plan.target });
    const deadline = Date.now() + 50_000;
    let reported = false;
    while (Date.now() < deadline && alive(pid)) {
      const health = await readJson<Health>(healthFile(plan)).catch(() => undefined);
      if (!reported && health?.version === application.getVersion() && health.pid === pid && health.session === plan.session) {
        await writeJson(files.health, { ...health, pid: process.pid, applicationPid: pid, launchMethod: 'workspace' });
        reported = true;
      }
      const current = await readJson<MacJournal>(files.journal);
      if (reported && current.state === 'confirmed') { application.exit(0); return true; }
      if (current.state === 'rolled-back' || !alive(journal.helperPid)) break;
      await sleep(100);
    }
    throw new Error('新版系统启动确认失败');
  } catch (error) {
    if (pid) await terminateMacApplication(pid);
    throw error;
  }
}

/** The real UI must pass the existing readiness handshake before notifying its supervisor. */
export async function confirmSystemMacStartup(options: { session: string; directory: string; executable: string; version: string }): Promise<void> {
  const plan = await readPlan(path.join(path.resolve(options.session), 'plan.json'));
  if (path.dirname(plan.session) !== options.directory || plan.target !== bundleForExecutable(options.executable)
    || plan.release.payload.version !== options.version) throw new Error('Mac 更新确认版本不符');
  const deadline = Date.now() + 5000;
  let receipt: LaunchReceipt | undefined;
  while (!receipt && Date.now() < deadline) {
    receipt = await readJson<LaunchReceipt>(receiptFile(plan)).catch(() => undefined);
    if (!receipt) await sleep(50);
  }
  const journal = await readJson<MacJournal>(locations(plan).journal);
  if (!receipt || receipt.target !== plan.target || receipt.applicationPid !== process.pid || !alive(receipt.supervisorPid)
    || !alive(journal.helperPid) || journal.childPid !== undefined && journal.childPid !== receipt.supervisorPid
    || !['swapping', 'launched'].includes(journal.state)) throw new Error('Mac 更新系统启动回执无效');
  await writeJson(healthFile(plan), { version: options.version, pid: process.pid, session: plan.session });
  // Do not let ordinary cache recovery delete the session before the supervisor
  // sees the old updater's confirmation and exits.
  const confirmationDeadline = Date.now() + 20_000;
  while (Date.now() < confirmationDeadline && alive(receipt.supervisorPid)) {
    const current = await readJson<MacJournal>(locations(plan).journal);
    if (current.state === 'rolled-back') throw new Error('Mac 更新已回滚');
    if (!alive(current.helperPid) && current.state !== 'confirmed') throw new Error('Mac 更新助手会话已失效');
    await sleep(100);
  }
  if (alive(receipt.supervisorPid) || (await readJson<MacJournal>(locations(plan).journal)).state !== 'confirmed') {
    throw new Error('Mac 更新系统启动确认超时');
  }
}
