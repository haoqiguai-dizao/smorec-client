import type { MacCameraStatus } from '../../shared/platform-permissions';
import { cameraError } from './camera-errors';

/** Permission, missing hardware, suspended hardware and a stale selection are
 * different states. Enrich only a missing-device error; never request access.
 */
export async function cameraErrorContext(reason: unknown, status = window.platformPermissions?.cameraStatus): Promise<string> {
  const fallback = cameraError(reason);
  if (!(reason instanceof Error) || reason.name !== 'NotFoundError' || !status) return fallback;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([status(), new Promise<MacCameraStatus | undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), 1500);
    })]);
    if (!result) return fallback;
    if (result.availableCount > 0) return '所选摄像头当前不可用，请刷新设备列表或选择其他摄像头';
    if (result.builtInSuspended) return '内置摄像头已被系统暂停，请打开电脑上盖后刷新，或选择外接摄像头';
    if (result.suspendedCount > 0) return '摄像头已连接但被系统暂停，请检查设备状态后刷新';
    return fallback;
  } catch { return fallback; }
  finally { clearTimeout(timer); }
}
