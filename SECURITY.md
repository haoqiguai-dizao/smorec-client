# 安全反馈

请勿在公开Issue、截图或示例中放入发布／签名私钥、直播推流密钥、Cookie、个人录屏、工程或可识别用户的日志。删除当前文件不能清除Git历史，密钥已经公开时应先撤销或轮换。

安全漏洞请通过 [GitHub私密漏洞报告](https://github.com/haoqiguai-dizao/smorec-client/security/advisories/new) 提交。普通功能问题可使用公开Issue；尚未协调披露的漏洞利用细节只放在私密报告中。

报告应包含受影响版本、平台、复现条件、影响和最小复现；尽量使用隔离账号、临时目录和合成数据。维护者确认接收、复现、修复和公开时间后再披露细节，不在没有证据时承诺响应时限。

需要重点检查的边界包括：渲染端IPC与来源校验、媒体路径和解码输入、更新签名及归档路径、原生本地接口、系统权限、可选模型下载和直播凭据存储。

## 已知依赖范围（2026-10-13）

锁定依赖的`npm audit`报告涉及14个包（9中、5高）；`--omit=dev`涉及2个高风险包：electron-updater与其builder-util-runtime，关联同一[上游跨域重定向凭据报告](https://github.com/advisories/GHSA-p2f4-r6v6-j797)。报告描述带认证头的更新下载跨域跳转可能泄露凭据；本快照的默认更新域名无效、信任公钥为空，没有配置该认证下载路径。Mac包排除electron-updater及lazy-val，且不使用该Windows更新链路；Windows更新源码仍引用electron-updater，衍生发行应先升级修复并验证更新链路，不将默认配置隔离当作依赖已修复的证明。

其余报告涉及构建/下载/样式工具的传递依赖。初始118快照保留经过验证的锁文件，本轮没有使用`npm audit fix --force`改写版本或发布新二进制；后续依赖升级需完成受影响的构建、更新和平台回归。Windows另有lazy-val许可全文及新机原生/安装器验证门槛，见 [第三方声明](THIRD_PARTY_NOTICES.md) 与 [构建说明](DEVELOPMENT.md)。
