import type { WindowsInstallResult } from './windows-installer';

const userSafeUpdateErrors = new Set([
  '更新网络暂不可用', '更新服务暂不可用', '更新服务暂不可用', '更新清单过大', '更新下载重定向无效',
  '更新下载失败', '更新包大小不符', '更新包超出登记大小', '更新包完整性校验失败', '更新包摘要校验失败',
  'Mac 更新包大小不符', 'Mac 更新包摘要校验失败', 'Mac 更新包文件数量无效', 'Mac 更新 ZIP 必须只包含当前应用',
  'Mac 更新 ZIP 包含不安全路径', 'Mac 应用文件过多', 'Mac 应用链接越界', 'Mac 应用展开体积过大',
  'Mac 应用包含特殊文件', 'Mac 更新应用身份无效', 'Mac 应用签名无效', 'Mac 更新版本或应用身份不符',
  'Mac 更新包架构不符', 'Mac 更新签名方式或团队与当前应用不符', 'Mac 更新组件不可用', '当前程序不在 Mac 应用包内',
  '更新路径包含链接或类型无效', '更新版本已变化', '更新文件尚未就绪', '应用更新组件不可用',
]);

/** Converts updater failures into actionable text without exposing local paths or command output. */
export function updateFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : '';
  if (userSafeUpdateErrors.has(message)) return `${message}，点击重试`;
  if (message === '更新已停止') return '更新已暂停，重新打开小录后重试';
  return '更新包下载或准备失败，请点击重试';
}

export function deferredUpdateMessage(result: WindowsInstallResult): string {
  if (result.status === 'failed') return '安装未完成，重启小录后重试';
  if (result.status !== 'deferred') return '';
  switch (result.reason) {
    case 'busy': return '请先结束录制或投屏，再重启更新';
    case 'elevation-required': return '当前安装目录不可写，请从官网重新安装到当前用户目录，之后即可免授权更新';
    case 'environment-unknown': return '无法确认安装环境，重启小录后重试';
    case 'installer-unavailable': case 'installer-mismatch': case 'download-changed':
      return '安装包需要重新下载，请检查更新';
    case 'invalid-installation': return '当前安装目录无效，请运行官网安装包修复';
    default: return '更新暂未安装，重启小录后重试';
  }
}
