# 开发与构建

这些命令在源码根目录执行。首次构建只需公开依赖和源码内固定运行库，不需要生产服务器、发布密钥或用户工程。不要在日常安装目录测试升级。

## 公共前端与 Electron

环境：Node.js 22.22+、npm 10+，Python 3.12+用于归档及可选FFmpeg源码构建。使用 `npm ci`，不要用 `npm install` 无意改写锁文件。网络需能访问锁文件中的 npm 镜像、GitHub Electron／FFmpeg 资源；下载失败应重试下载，不取消证书检查。装有多版本Python时应显式选择3.12+解释器。

```sh
npm ci
npm run lint
npm run typecheck
npx tsx --test --test-concurrency=4 tests/*.test.ts tests/*.test.tsx
npm run build
```

`prebuild`从锁定 MediaPipe 包准备模型运行时，模型文件已随源码提供并验证摘要。`dev:web`只打开本地 Vite 界面。`npm run dev`启动 Electron；首次录制需在系统设置给对应开发进程授权，不能继承官方应用权限。

## macOS Apple Silicon

需要 macOS 15+、Apple Command Line Tools（`xcode-select --install`）、Swift 6、Clang 与 make。当前实测工具为 Swift 6.4、macOS 27，最低版本声明不等于每个系统版本已实测。

```sh
npm run native:mac:build
```

公开快照的pre脚本先下载并校验官方sherpa-onnx1.12.29的NO-TTS共享运行库，保留arm64切片；随后Swift生成采集、启动器及摄像头组件，Clang编译C语音工具。历史本地dylib未进入快照，不依赖个人项目缓存。该程序只需语音识别，不包含不用的piper/espeak合成引擎。完整出处、许可和生成摘要见`native/macos/Vendor/SherpaOnnx/NOTICE.txt`及`PUBLIC-RUNTIME.json`。

打包前先从源码构建FFmpeg。安装公开的 `pkg-config`（或pkgconf）、Meson和Ninja开发工具；Python环境中可以用`python3 -m pip install meson ninja`安装后两者，确保三者都在PATH。先用`python3 --version`确认3.12+，多版本机器将所选解释器目录放在PATH前端，再执行npm命令。无需下载或使用官方小录二进制。

```sh
npm run ffmpeg:mac:build
node scripts/open-source/verify-ffmpeg.mjs
npm run legal:mac:prepare
npm run package:mac:dir
```

配方固定FFmpeg6.1.1、x264、libwebp1.6.0、dav1d1.5.3、libvpx1.15.0，验证五份上游源码摘要，在`output/ffmpeg-gpl`生成arm64/macOS15程序及完整对应源码。打包和预检使用这个目录中的实际程序；Mac包排除`ffmpeg-static`、`electron-updater`及`lazy-val`，不使用npm下载的旧程序。重装npm依赖不会覆盖独立FFmpeg输出，程序和收据完整时可复用，不必重复编译。

`legal:mac:prepare`从源码根目录声明、锁定Electron/Chromium原文和MediaPipe材料生成`output/release-legal`。已有目录会被拒绝，避免覆盖已验收材料；版本或依赖改变后，先核对旧目录为本副本可重建生成物并已不需要，再移除并重新生成。打包前门禁验证许可原文、语音库、FFmpeg配置、精确源码和构建配方，缺文件或摘要不符会失败。准备输出均位于本副本；不发布、不安装、不申请系统扩展。

本地 ad-hoc包可用于普通桌面功能验证，不能激活系统虚拟摄像头。正式身份通过 `MAC_CAMERA_SIGNING_IDENTITY` 与 `MAC_CAMERA_TEAM_ID` 提供；证书、公证凭据不进入源码。

## Windows x64

需要 Windows、.NET 8 SDK、Python 3和PowerShell。虚拟摄像头脚本使用项目内固定Microsoft工具链目录，须先按`native/tools/README.md`执行官方组件bootstrap；仅安装全局Visual Studio不会自动满足这个目录。bootstrap遵守Microsoft组件条款，不将工具链放入公开源码或安装包。原生工具只在Windows构建，不能用Mac编译前端通过来替代Windows验收。

```powershell
npm ci
python native/tools/bootstrap_toolchain.py
npm run build
npm run native:build
node scripts/open-source/verify-ffmpeg.mjs
npm run package:dir
```

采集器使用固定的 `ScreenRecorderLib.dll`，源码、MIT声明和修改补丁见 `native/vendor/README.md`。希望重建该第三方DLL时，按该文档获取精确上游提交并应用全部补丁；正式程序所需DLL已随快照提供。虚拟摄像头构建会执行未注册的自测，系统注册是另一步安装操作。

NSIS安装器的目录和磁盘场景检查：`npm run verify:installer`；生成安装器：`npm run package:win`。需要在隔离目录检查新装、旧版升级、录制、白板反复开关、直播输出和卸载保留用户数据。Windows原生链路尚未在新Windows机器上执行。

## 验证边界与数据

自动测试使用受控状态、合成媒体、临时目录和回环网络。运行测试需要允许本地套接字；失败应先区分环境限制与产品错误，不删除失败用例。物理设备热切换、长录同步、系统授权和第三方直播助手收画需要单独实测。

官方与本地开发默认数据目录可能一致。完整桌面集成测试同时隔离偏好与工程，例如：

```sh
npm run dev -- --user-data-dir=/absolute/path/to/new-profile --smorec-test-root=/absolute/path/to/new-projects
```

启动已编译程序时可将`npm run dev`换成`npm start`。两个路径都使用自己的空目录；`--user-data-dir`隔离Electron偏好／会话，`--smorec-test-root`隔离工程与临时媒体。前一个参数已在本次独立Electron探针核对，后一个由客户端显式处理。不要将真实项目放入测试根；结束后只删除该次生成的可重建产物。

若自行发布衍生包，应更换应用身份、数据目录、图标／品牌及更新服务，使用自己的签名和信任公钥，保留第三方声明及对应源码。不要把它发布到小录官方更新通道。
