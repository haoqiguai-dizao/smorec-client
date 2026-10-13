const base = require('../package.json').build;
const formal = Boolean(process.env.MAC_CAMERA_SIGNING_IDENTITY);
const entitlements = formal ? 'build/mac-entitlements.plist' : 'build/mac-local-entitlements.plist';

// The Windows resource list contains EXEs/DLLs and must never enter a Mac bundle.
module.exports = {
  ...base,
  artifactBuildStarted: undefined,
  // Keep private application source maps local; only compiled runtime code is distributed.
  files: [...base.files, '!dist/**/*.map', '!dist-electron/**/*.map', '!node_modules/ffmpeg-static{,/**}', '!node_modules/electron-updater{,/**}', '!node_modules/lazy-val{,/**}'],
  asarUnpack: [],
  afterPack: './scripts/after-pack-mac.cjs',
  extraResources: [
    { from: 'output/ffmpeg-gpl', to: 'ffmpeg', filter: ['ffmpeg', 'LICENSE.*', 'PATENTS.*', 'SOURCE-BUILD.json', '*corresponding-source.tar.gz', 'README.txt'] },
    { from: 'output/release-legal', to: 'legal' },
    { from: 'native/macos/.build/release/XiaoLu.Capture', to: 'native/XiaoLu.Capture' },
    { from: 'native/macos/.build/release/XiaoLu.Launch', to: 'native/XiaoLu.Launch' },
    { from: 'native/macos/.build/release/speech', to: 'native/speech', filter: ['XiaoLu.Speech'] },
    // Frontend-only releases may reuse an older generated directory; runtime and notices are versioned inputs.
    { from: 'native/macos/Vendor/SherpaOnnx', to: 'native/speech', filter: ['libsherpa-onnx-c-api.dylib', 'libonnxruntime.1.23.2.dylib', 'NOTICE.txt', 'LICENSE-APACHE-2.0.txt', 'ONNXRUNTIME-THIRD-PARTY-NOTICES.txt', 'PUBLIC-RUNTIME.json'] },
    { from: 'sites/website/assets/xiaolu-icon.png', to: 'assets/icon.png' },
  ],
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }],
    category: 'public.app-category.video',
    identity: process.env.MAC_CAMERA_SIGNING_IDENTITY || '-',
    // The capture host is a separate app with a Chinese name/icon and its own privacy identity.
    signIgnore: ['Contents/Library/SystemExtensions/', 'Contents/MacOS/XiaoLu\\.CameraBridge$', 'Contents/Resources/native/XiaoLu\\.Capture(?:\\.app/.*)?$'],
    minimumSystemVersion: '15.0',
    icon: 'build/icon.icns',
    hardenedRuntime: formal,
    entitlements,
    entitlementsInherit: entitlements,
    extendInfo: {
      NSSystemExtensionUsageDescription: '安装小录虚拟摄像头，将合成画面提供给直播和会议软件。',
      NSCameraUsageDescription: '小录使用摄像头录制人物画面和直播投屏。',
      NSMicrophoneUsageDescription: '小录使用所选麦克风录制独立声音轨道及试录试听。',
      NSScreenCaptureUsageDescription: '小录录制你选择的屏幕、窗口或区域和系统声音。',
      NSAudioCaptureUsageDescription: '小录录制系统声音，并与麦克风分别保存。',
    },
    artifactName: '${productName}-${version}-mac-${arch}.${ext}',
  },
};
