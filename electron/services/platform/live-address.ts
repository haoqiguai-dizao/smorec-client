import path from 'node:path';

export function liveFrameAddress(name: string, platform = process.platform, uid = process.getuid?.()): string {
  if (!/^xiaolu-live-[a-f0-9-]{36}$/i.test(name)) throw new Error('直播通道标识无效');
  if (platform === 'win32') return '\\\\.\\pipe\\' + name;
  if (platform === 'darwin' && Number.isSafeInteger(uid) && uid! >= 0) return path.posix.join('/tmp', `smorec-${uid}`, name + '.sock');
  throw new Error('当前系统不支持直播通道');
}
