# 首次公开范围

本仓库以0.9.118客户端的筛选快照创建初始提交，公共地址为 [haoqiguai-dizao/smorec-client](https://github.com/haoqiguai-dizao/smorec-client)。自有代码、文档及必要图标采用GPL-3.0-or-later，完整条款在根目录 [LICENSE](LICENSE)，package.json及锁文件根包使用同一SPDX。第三方独立文件继续使用原许可。

包含：React/Electron/shared、Mac及Windows原生源码、必要第三方模型/固定Windows运行库、客户端回归和构建工具、开发者文档与第三方原文。Mac识别库从固定公开上游下载并验证；FFmpeg由随源码提供的精确配方生成。

排除：原私库及Git历史、生产后端/运维/发布工具、更新信任公钥、凭据、真实用户工程和媒体、真人宣传素材、构建目录与安装器。开发更新地址为`updates.invalid`，不连接官方更新通道。

首次公开仅提交本客户端快照。原私库保持私有，生产入口与官方二进制独立管理；源码公开不改变收费、代码签名、系统权限或设备兼容保证。源码逐文件摘要见 [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json)，构建验收与平台边界见 [VERIFICATION](VERIFICATION.md)。

已授予的GPL权利不会因之后停止公开发布而撤销。品牌和官方身份不构成额外的软件许可限制，边界见 [ASSETS](ASSETS.md)。

Mac为本轮主要验证平台；Windows新环境原生/安装器、Mac15实机、物理设备/长录/外部直播尚未验收。Windows二进制还存在lazy-val上游MIT全文缺口，必须在衍生二进制分发前处理，不能用Mac包通过替代。

2026-10-14补充README展示：新增本次专门制作的ImageGen封面、合成讲解内容及三份源码组件截图，按GPL-3.0-or-later开放，详见[图片来源](docs/readme/README.md)。既有真人素材、用户工程与原私库历史继续排除。
