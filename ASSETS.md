# 素材与品牌范围

以下自有资源与本仓库客户端采用GPL-3.0-or-later；第三方资源保留各自许可。完整条款见 [LICENSE](LICENSE)。

| 资源 | 来源与处理 |
| --- | --- |
| `build/icon.ico`、`build/icon.icns`、`sites/website/assets/xiaolu-icon.png` | 现有客户端品牌图标，初始源码为构建需要保留。与客户端自有资源同按GPL-3.0-or-later开放版权使用；不授予官方身份或品牌背书。 |
| `public/beauty/face_landmarker.task` | Google Face Landmarker float16 revision 1，保留模型卡来源、Apache-2.0声明和SHA256。 |
| MediaPipe JS/WASM | 从锁定公开包生成，保留Apache-2.0原声明；不把生成文件当成手写项目源码。 |
| 原生第三方DLL／dylib | 固定ScreenRecorder DLL随源码保留MIT；历史Mac语音dylib排除，构建时获取官方识别专用版本，许可证及摘要见第三方声明，不能更改为项目许可证。 |
| 语音模型 | 可选下载，模型和tokens有固定SHA256；不随初始源码打包，下载来源及声明在语音模块中保留。 |
| 官网视频、真人照片、演示录屏、设计截图 | 初始公开范围全部排除，不因项目开源默认许可他人使用。 |

小录名称及图标用于标识原项目；衍生产品应明确为非官方构建，避免造成官方支持、发行主体或兼容保证的误解。此要求只针对混淆和背书，不限制GPL-3.0-or-later授予的软件使用、修改、商用与再分发权利。
