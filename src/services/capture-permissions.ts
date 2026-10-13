import type { MacPermission, PermissionStatus } from '../../shared/platform-permissions';

export const PERMISSION_NAMES: Record<MacPermission, string> = {
  screen: '屏幕录制', camera: '摄像头', microphone: '麦克风', input: '输入监控', accessibility: '辅助功能',
};
export const PERMISSION_PANES: Record<MacPermission, string> = {
  screen: '录屏与系统录音', camera: '摄像头', microphone: '麦克风', input: '输入监控', accessibility: '辅助功能',
};

/** Selected features must be ready before capture; opting out is an explicit user choice. */
export function capturePermissionNeeds(camera: boolean, microphone: boolean, inputRecording = false): MacPermission[] {
  return ['screen', ...(camera ? ['camera' as const] : []), ...(microphone ? ['microphone' as const] : []),
    ...(inputRecording ? ['input' as const, 'accessibility' as const] : [])];
}

export function capturePermissionState(needs: MacPermission[], status: PermissionStatus[] | null) {
  const unresolved = needs.filter(kind => !status?.find(item => item.kind === kind)?.granted);
  const unknown = unresolved.filter(kind => !status?.some(item => item.kind === kind));
  return { unresolved, unknown, ready: status !== null && unresolved.length === 0 };
}

export function permissionAccessLabel(item?: PermissionStatus): string {
  if (!item) return '未读取';
  if (item.granted) return '已允许';
  if (item.access === 'restricted') return '系统限制';
  if (item.access === 'not-determined') return '尚未授权';
  if (item.access === 'unknown') return '状态未知';
  return '未允许';
}
