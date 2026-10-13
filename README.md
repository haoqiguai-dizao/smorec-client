# 小录客户端

小录将屏幕、摄像头、麦克风、白板和演示效果组合成录制或直播画面，并提供本地视频编辑与导出。

本仓库以 GPL-3.0-or-later 开放小录 0.9.118 客户端源码、自有文档及必要图标。可以按该许可使用、修改、商用和再分发，完整条款见 [LICENSE](LICENSE)。第三方独立组件保留各自许可证，具体范围见 [首次公开范围](PUBLICATION-PLAN.md)。

公共源码仓库：[haoqiguai-dizao/smorec-client](https://github.com/haoqiguai-dizao/smorec-client)。这是筛选后的客户端初始快照，原私库历史未纳入。

## 开发

使用 Node.js 22（至少 22.22）、npm 10+ 和锁定的 package-lock.json：

```sh
npm ci
npm run dev:web
```

网页模式用于界面开发；真实屏幕采集、设备权限和系统虚拟摄像头需要桌面与原生组件。完整步骤见 [开发与构建](DEVELOPMENT.md)，代码入口见 [架构](ARCHITECTURE.md)。

```sh
npm run lint
npm run typecheck
npx tsx --test --test-concurrency=4 tests/*.test.ts tests/*.test.tsx
npm run build
```

原生支持目标为 Windows x64 和 macOS 15+ Apple Silicon。Linux 与 Intel Mac 目前没有完整原生录制支持，不应把网页能运行当作这些平台已经兼容。

当前源码快照的实际验证与未验证边界见[VERIFICATION](VERIFICATION.md)。

## 源码与官方发行

此源码包含客户端、原生采集及虚拟摄像头实现、必要模型和固定的第三方原生运行库。生产后端、发布凭据、日常用户工程及真人宣传素材不在此范围。

开发快照使用无效更新域名与空信任公钥，避免自编译程序自动替换为官方包。官方发行的代码签名、更新签名及系统授权是独立环节。Mac 虚拟摄像头扩展仍需要发行主体的 Apple 签名和用户系统批准；开源不改变该条件。

贡献方式见 [CONTRIBUTING](CONTRIBUTING.md)，安全反馈见 [SECURITY](SECURITY.md)，第三方声明见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)，素材与品牌边界见 [ASSETS](ASSETS.md)。
