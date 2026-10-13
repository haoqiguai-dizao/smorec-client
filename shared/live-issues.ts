export const LIVE_CAMERA_WARNING = '人物画面暂时不可用，屏幕和声音继续输出';

/** Only fixed product messages cross the renderer diagnostic boundary. */
export const LIVE_RUNTIME_ISSUES = {
  'camera-unavailable': { fatal: false, message: LIVE_CAMERA_WARNING },
  'camera-restored': { fatal: false, message: undefined },
  'renderer-pull': { fatal: true, message: '直播采集画面读取失败，请重新开始预览' },
  'renderer-compose': { fatal: true, message: '直播画面合成失败，请重新开始预览' },
  'renderer-push': { fatal: true, message: '直播画面输出失败，请重新开始预览' },
  'renderer-progress': { fatal: true, message: '直播状态更新失败，请重新开始预览' },
} as const;
export type LiveRuntimeIssue = keyof typeof LIVE_RUNTIME_ISSUES;

export function isLiveRuntimeIssue(value: unknown): value is LiveRuntimeIssue {
  return typeof value === 'string' && Object.hasOwn(LIVE_RUNTIME_ISSUES, value);
}
