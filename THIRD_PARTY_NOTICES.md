# 第三方软件与来源

完整锁定包清单见 [DEPENDENCIES.json](DEPENDENCIES.json)，由package-lock.json生成，包含开发工具；包的许可不等于实际下载二进制的许可。已收集的npm运行依赖原文见[THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt)，原生／模型原文另存于各自目录。

| 组件 | 锁定版本／来源 | 许可及分发要求 |
| --- | --- | --- |
| React / React DOM | 19.2.8，[上游](https://github.com/facebook/react) | MIT，保留版权与许可全文 |
| Electron | 44.2.0，[上游](https://github.com/electron/electron) | MIT及Chromium第三方声明，正式包须保留其LICENSE／LICENSES.chromium.html |
| electron-updater | 6.8.3，[上游](https://github.com/electron-userland/electron-builder) | MIT，保留原声明 |
| lucide-react | 1.41.0，[上游](https://github.com/lucide-icons/lucide) | ISC；具体图标来源亦见包内LICENSE |
| semver | 7.8.5，[上游](https://github.com/npm/node-semver) | ISC，保留原声明 |
| mediabunny | 1.55.7，[源码](https://github.com/Vanilagy/mediabunny) | MPL-2.0，提供锁定版本源码获取方式；若修改覆盖文件，提供其修改源码并保留MPL声明 |
| ffmpeg-static包装代码 | 5.3.0，[源码](https://github.com/eugeneware/ffmpeg-static) | GPL-3.0-or-later。执行外部FFmpeg不自动确定整个客户端必须用哪一许可 |
| FFmpeg程序 | Mac使用公开配方构建6.1.1；Windows仍由npm安装脚本下载 | 按实际configure判断。含`--enable-nonfree`的程序不可再分发；Mac构建采用GPL-3.0-or-later，随包附精确源码、配方、配置及GPL全文 |
| x264（Mac替代构建） | VideoLAN提交b35605ace3ddf7c1a5d67a2eb553f034aef41d55 | GPL-2.0-or-later；与version3 FFmpeg组合按GPL3分发，保留来源及源代码 |
| libwebp（Mac替代构建） | 1.6.0，Google WebM项目固定源码 | BSD-3-Clause，保留COPYING；完整源码与FFmpeg配方一起归档 |
| dav1d（Mac构建） | 1.5.3，VideoLAN固定源码 | BSD-2-Clause，保留COPYING及精确源码 |
| libvpx（Mac构建） | 1.15.0，Google WebM固定源码 | BSD-3-Clause及PATENTS，原文与精确源码随包保留 |
| ScreenRecorderLib | v7.0.1固定fork，提交646383234187efd3854e6b1069612b80c3ab9981 | MIT；完整修改补丁、DLL摘要及构建步骤在`native/vendor` |
| NAudio、fifo_map、C++/WinRT | 原生声明见`native/THIRD-PARTY-NOTICES.txt` | MIT，保留各自声明；.NET/NuGet运行时亦保留原许可证 |
| sherpa-onnx | Mac1.12.29官方NO-TTS构建 / C header，Windows NuGet1.13.5 | 自身代码Apache-2.0；旧Mac运行库含piper/espeak GPL部分，已排除，构建时取校验的官方NO-TTS版本。Windows实际NuGet组件许可另待原生验收。详见[NATIVE-SPEECH-NOTICES](NATIVE-SPEECH-NOTICES.txt) |
| ONNX Runtime | Mac1.23.2 | MIT及完整第三方声明；同目录保留官方v1.23.2原文 |
| MediaPipe Tasks Vision | 1.0.1，Face Landmarker float16 revision1 | Apache-2.0；源码、模型卡、SHA256及原文在`public/beauty` |
| parse-cache-control | 1.0.1（锁文件未给SPDX字段） | 已读包内三条款BSD全文，补充标识BSD-3-Clause；不能以缺失元数据误认为无许可证 |
| lazy-val | 1.0.5，[作者上游](https://github.com/develar/lazy-val) | npm和上游package.json均声明MIT，但包与仓库均未提供LICENSE全文。Mac包排除未使用的electron-updater及lazy-val；Windows二进制对外分发前仍需补齐有效声明或替换依赖。源码的锁文件保留真实依赖信息，不冒用其他项目版权填补。 |

本项目GPL-3.0-or-later不覆盖第三方独立文件的原许可，不把品牌声明当作收紧开放许可证的额外软件限制。MPL与GPL组合应按[MPL官方FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/#mpl-and-lgpl)保留必要的双重获取权利，不擅自将MPL源码改成GPL-only。FFmpeg分发依据见[官方法律说明](https://ffmpeg.org/legal.html)。

依赖变化后，安装锁定依赖并运行`node scripts/open-source/audit-dependencies.mjs`重新生成清单与原文，人工复核缺失许可、模型和原生来源后更新对应公共文档；不要把脚本输出当作法律放行。二进制发行另外保存对应源码和构建记录，并把源代码下载入口与二进制一起提供；本仓库源码公开不是既有官方二进制已完成许可补正的证明。
