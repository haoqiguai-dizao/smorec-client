小录 Mac {{VERSION}} 软件许可与源码

FFmpeg 6.1.1 与 x264：GPL-3.0-or-later。版权所有 FFmpeg / x264 原作者；无担保；可以按附带 GPL 复制、修改和再分发。
完整对应源码、各组件上游档案、构建配方和本次配置在同一 Resources 目录的 ffmpeg/ffmpeg-corresponding-source.tar.gz、SOURCE-BUILD.json。dav1d 1.5.3、libvpx 1.15.0、libwebp 1.6.0 的 BSD 原文与 libvpx 专利授权同目录保留。
本公开客户端自有代码、文档及必要图标采用GPL-3.0-or-later，全文见本目录LICENSE.client.txt。客户端源码见https://github.com/haoqiguai-dizao/smorec-client；再分发二进制须同时提供与该二进制匹配的完整对应源码及构建步骤。上述FFmpeg源码归档不包含客户端源码，不能替代客户端对应源码。

Mac 包不包含 ffmpeg-static 的 GPL JavaScript 包装代码、electron-updater 或 lazy-val。lazy-val 上游 MIT 元数据缺全文的问题仍需在Windows二进制分发前处理；Mac包排除未使用的Windows依赖。

语音识别使用官方 sherpa-onnx 1.12.29 NO-TTS 与 ONNX Runtime 1.23.2，Apache-2.0 / MIT 及其组件完整原文已附；无 eSpeak 引擎。
前端/Node 的其他第三方全文见 npm-licenses.txt；MediaPipe 许可与来源见同目录原文。MediaBunny 1.55.7：MPL-2.0，未修改上游文件，固定版本完整源文件随 app.asar 的 node_modules/mediabunny/src 与 LICENSE 提供 。
Electron 的 MIT 与 Chromium 原文在 本目录 LICENSE.electron.txt 和 LICENSES.chromium.html。
