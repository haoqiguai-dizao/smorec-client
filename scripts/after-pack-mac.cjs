const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const extensionID = 'studio.frameflow.desktop.camera-extension';

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const root = context.packager.projectDir;
  const local = context.packager.platformSpecificBuildOptions.identity === '-';
  const identity = local ? '-' : process.env.MAC_CAMERA_SIGNING_IDENTITY;
  const team = local ? 'LOCALTEST0' : process.env.MAC_CAMERA_TEAM_ID;
  if (!identity || !team || !/^[A-Z0-9]{10}$/.test(team)) {
    throw new Error('正式 Mac 摄像头包需要明确提供 MAC_CAMERA_SIGNING_IDENTITY 与 MAC_CAMERA_TEAM_ID');
  }
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const extension = path.join(app, 'Contents', 'Library', 'SystemExtensions', `${extensionID}.systemextension`);
  const macos = path.join(extension, 'Contents', 'MacOS');
  await fs.mkdir(macos, { recursive: true });
  const native = path.join(root, 'native', 'macos', '.build', 'release');
  await fs.copyFile(path.join(native, 'XiaoLu.CameraExtension'), path.join(macos, 'XiaoLu.CameraExtension'));
  const info = {
    CFBundleIdentifier: extensionID, CFBundleExecutable: 'XiaoLu.CameraExtension', CFBundleName: '小录 Virtual Camera',
    CFBundlePackageType: 'SYSX', CFBundleInfoDictionaryVersion: '6.0',
    CFBundleVersion: context.packager.appInfo.version, CFBundleShortVersionString: context.packager.appInfo.version,
    CFBundleSupportedPlatforms: ['MacOSX'], LSMinimumSystemVersion: '15.0',
    NSSystemExtensionUsageDescription: '把小录合成的屏幕和人物画面提供给你选择的直播或会议软件。',
    CMIOExtension: { CMIOExtensionMachServiceName: `${team}.${extensionID}` },
  };
  const plist = path.join(extension, 'Contents', 'Info.plist');
  await fs.writeFile(plist, JSON.stringify(info));
  await run('/usr/bin/plutil', ['-convert', 'xml1', plist]);
  const captureBinary = path.join(app, 'Contents', 'Resources', 'native', 'XiaoLu.Capture');
  const captureBundle = path.join(app, 'Contents', 'Resources', 'native', 'XiaoLu.Capture.app');
  const captureMacOS = path.join(captureBundle, 'Contents', 'MacOS');
  await fs.mkdir(captureMacOS, { recursive: true });
  await fs.copyFile(captureBinary, path.join(captureMacOS, '小录采集'));
  await fs.rm(captureBinary, { force: true });
  const captureResources = path.join(captureBundle, 'Contents', 'Resources');
  await fs.mkdir(captureResources, { recursive: true });
  await fs.copyFile(path.join(root, 'build/icon.icns'), path.join(captureResources, 'icon.icns'));
  // Frontend releases must not rotate the ad-hoc capture identity when its code and resources are unchanged.
  const captureInfo = {
    CFBundleIdentifier: 'studio.frameflow.desktop.capture',
    CFBundleExecutable: '小录采集',
    CFBundleName: '小录采集',
    CFBundleDisplayName: '小录采集',
    CFBundleIconFile: 'icon.icns',
    CFBundlePackageType: 'APPL',
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleVersion: '1',
    CFBundleShortVersionString: '1.0.0',
    CFBundleSupportedPlatforms: ['MacOSX'],
    LSMinimumSystemVersion: '15.0',
    LSUIElement: true,
    NSScreenCaptureUsageDescription: '小录录制你选择的屏幕、窗口或区域和系统声音。',
    NSMicrophoneUsageDescription: '小录使用所选麦克风录制独立声音轨道。',
  };
  const captureInfoPath = path.join(captureBundle, 'Contents', 'Info.plist');
  await fs.writeFile(captureInfoPath, JSON.stringify(captureInfo));
  await run('/usr/bin/plutil', ['-convert', 'xml1', captureInfoPath]);
  const bridge = path.join(app, 'Contents', 'MacOS', 'XiaoLu.CameraBridge');
  await fs.copyFile(path.join(native, 'XiaoLu.CameraBridge'), bridge);
  const speech = path.join(app, 'Contents', 'Resources', 'native', 'speech');
  for (const name of ['libonnxruntime.1.23.2.dylib', 'libsherpa-onnx-c-api.dylib', 'XiaoLu.Speech']) {
    await run('/usr/bin/codesign', ['--force', '--sign', identity,
      ...(local ? [] : ['--options', 'runtime', '--timestamp']), path.join(speech, name)]);
  }
  await run('/usr/bin/codesign', ['--force', '--sign', identity,
    ...(local ? [] : ['--options', 'runtime', '--timestamp']), path.join(app, 'Contents/Resources/native/XiaoLu.Launch')]);
  // The capture app has its own identity and is started by Launch Services, never as the main app's child.
  const captureEntitlements = local ? 'mac-local-entitlements.plist' : 'mac-entitlements.plist';
  for (const [target, identifier, entitlements] of [
    [captureBundle, 'studio.frameflow.desktop.capture', captureEntitlements],
    [extension, extensionID, 'mac-camera-entitlements.plist'],
    [bridge, 'studio.frameflow.camera-bridge', local ? 'mac-local-entitlements.plist' : 'mac-bridge-entitlements.plist'],
  ]) {
    await run('/usr/bin/codesign', ['--force', '--sign', identity, '--identifier', identifier,
      '--entitlements', path.join(root, 'build', entitlements), ...(local ? [] : ['--options', 'runtime', '--timestamp']), target]);
  }
};
