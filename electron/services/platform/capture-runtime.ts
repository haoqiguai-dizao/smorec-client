import path from 'node:path';

interface RuntimeLocation { platform: string; resourcesPath: string; appPath: string; override?: string }

/** Select an executable within this application's resources; never accept renderer-supplied paths. */
export function captureExecutableCandidates(location: RuntimeLocation): string[] {
  const { platform, resourcesPath, appPath } = location;
  if (platform === 'darwin') return [
    path.join(resourcesPath, 'native', 'XiaoLu.Capture.app', 'Contents', 'MacOS', '小录采集'),
    path.join(resourcesPath, 'native', 'XiaoLu.Capture.app', 'Contents', 'MacOS', 'XiaoLu.Capture'),
    path.join(resourcesPath, 'native', 'XiaoLu.Capture'),
    path.join(appPath, 'native', 'macos', '.build', 'release', 'XiaoLu.Capture'),
    path.join(appPath, 'native', 'macos', '.build', 'debug', 'XiaoLu.Capture'),
  ];
  if (platform !== 'win32') return [];
  return [path.join(resourcesPath, 'native', 'FrameFlow.Capture.exe'),
    path.join(appPath, 'native', 'publish', 'FrameFlow.Capture.exe'),
    path.join(appPath, 'native', 'FrameFlow.Capture', 'bin', 'Release', 'net8.0-windows10.0.19041.0', 'win-x64', 'publish', 'FrameFlow.Capture.exe'),
    path.join(appPath, 'native', 'FrameFlow.Capture', 'bin', 'Release', 'net8.0-windows10.0.19041.0', 'FrameFlow.Capture.exe')];
}

export function nativeBuildHint(platform: string): string {
  if (platform === 'darwin') return 'Mac 录制模块尚未构建，请先运行 npm run native:mac:build';
  if (platform === 'win32') return 'Windows 录制模块尚未构建，请先运行 npm run native:build';
  return '当前系统尚不支持原生录制';
}

/** macOS returns an NSView pointer, not a CGWindowID. It must never be sent as a window ID. */
export function captureWindowHandle(buffer: Buffer, platform: string): string | undefined {
  if (platform !== 'win32') return undefined;
  if (buffer.length < 4) throw new Error('窗口句柄无效');
  return buffer.length >= 8 ? buffer.readBigUInt64LE().toString() : String(buffer.readUInt32LE());
}
