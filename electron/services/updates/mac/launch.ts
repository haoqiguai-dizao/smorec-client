import { promises as fs } from 'node:fs';
import path from 'node:path';
import { command } from './bundle';
import { alive, regularPath, sleep } from './paths';
import { parseMacLaunchReceipt } from '../../platform/mac-launch-receipt';

export const launcherInBundle = (target: string) => path.join(target, 'Contents', 'Resources', 'native', 'XiaoLu.Launch');

/** Copy only from the already signature-verified candidate, before either bundle moves. */
export async function prepareMacLauncher(candidate: string, session: string): Promise<string> {
  const source = launcherInBundle(candidate), launcher = path.join(session, 'mac-launcher');
  await regularPath(source);
  await fs.copyFile(source, launcher, fs.constants.COPYFILE_EXCL);
  await fs.chmod(launcher, 0o700);
  return launcher;
}

export async function launchMacApplication(target: string, args: string[], launcher = launcherInBundle(target)): Promise<number> {
  await regularPath(target, true); await regularPath(launcher);
  const result = parseMacLaunchReceipt((await command(launcher, [target, JSON.stringify(args)])).stdout, target);
  if (!alive(result.pid)) {
    throw new Error('Mac 应用启动回执无效', { cause: { expectedTarget: target, receivedTarget: result.target,
      pid: result.pid, running: Number.isSafeInteger(result.pid) && alive(result.pid) } });
  }
  return result.pid;
}

export async function terminateMacApplication(pid: number): Promise<void> {
  if (!alive(pid)) return;
  process.kill(pid, 'SIGTERM');
  for (let n = 0; n < 50 && alive(pid); n++) await sleep(100);
  if (alive(pid)) process.kill(pid, 'SIGKILL');
  for (let n = 0; n < 50 && alive(pid); n++) await sleep(100);
  if (alive(pid)) throw new Error('新版进程尚未退出，保留备份等待恢复');
}
