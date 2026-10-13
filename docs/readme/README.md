# README图片来源

2026-10-14为公开客户端仓库专门制作。资源和本仓库自有文档采用GPL-3.0-or-later，见 [LICENSE](../../LICENSE)；现有品牌图标的官方身份边界见 [ASSETS](../../ASSETS.md)。

| 文件 | 制作方式与范围 |
| --- | --- |
| `hero.png` | 使用Codex内置ImageGen，参考已公开的品牌图标，生成README封面插画。屏幕、白板、声音和时间轴是抽象符号，不是应用截图。 |
| `lesson-example.png` | 使用同一ImageGen生成“把一件事讲清楚”的示例讲解图。全部为本次合成内容，没有客户、业务或个人资料。 |
| `recorder.jpg` | 内置浏览器捕获公开源码的RecorderLauncher组件，按当前1120px原生窗口宽度展示录制准备和范围面板；屏幕/麦克风列表为模拟数据。仅裁取完整组件边界，没有重画按钮或替换控件。 |
| `whiteboard.jpg` | 捕获公开源码的Whiteboard组件，使用上面的合成图片，显示当前白板视角与书写工具。 |
| `editor.jpg` | 捕获公开源码的App编辑器组件，使用由合成讲解图生成的12秒视频和示例光标数据；时间轴与画布属性均由实际组件渲染。 |
| `voice-whiteboard.gif` | 16秒、960×531、12 FPS循环动图。复用WhiteboardHeader、WhiteboardTools、WhiteboardSpeechStatus界面组件，以正式drawRecordedBoard/boardAt按源时间重放示例事件；展示模拟识别文字写入、逐笔/逐字/连线和原位改字。不录制声音，也不执行本机语音识别。 |
| `live-auto-zoom.gif` | 12秒、840×465、10 FPS循环动图。将上面的editor.jpg作为静态样例源画面，用正式LiveComposition/LiveZoom处理合成点击、输入焦点与文本选区事件，展示缩放、焦点切换和回到全景；缩略图保留原始比例作对照。输入坐标为预设，不是现场操作录像，不访问设备或网络推流。 |
| `camera-presenter.png` | 内置ImageGen生成的虚构成年讲解者，作为摄像头合成的静态源图片；不基于真人，也不是摄像头采集帧。 |
| `camera-recording.gif` | 16秒、960×531、12 FPS循环动图。复用正式renderFrame/drawWebcam、webcamStyleAt、generateAutoZooms/cameraAt，以及CameraControls/CameraZoomControl。屏幕源为上面的editor.jpg，人物源为camera-presenter.png；预设人物布局轨迹、点击与输入焦点，展示圆形/圆角浮窗、位置/大小、1.4倍人物特写、1.7倍屏幕聚焦时人物窗缩小和恢复。控件显示样例状态，未接入设备控制。 |

界面来源为0.9.118公开源码，基线提交70f426d3812317f1de48717b600ac69a9e40df4f。浏览器预览只替代本地桥接数据和图片协议，不修改产品组件、布局或业务逻辑；录制/导出/模型下载和真实硬件访问在演示中禁用。截图用于说明界面，不作为真实采集、输出质量、平台直播或官方发行验收的证据。

生成提示词见 [IMAGEGEN-PROMPTS.json](IMAGEGEN-PROMPTS.json)。更换截图时使用无私人资料的独立示例，保持截取时的版本和来源说明，不把新概念图当成已实现界面。

两份GIF的界面与合成器基线为ba38fe1d0ac196a108d7171c7a3c04b4fedd0757，未修改产品代码。内置浏览器按1/12秒源时间取帧，本项目已验收的GPL FFmpeg进行调色板与尺寸压缩；直播动图降至10 FPS。动图仅呈现上述示例事件的界面和渲染效果，不验证真实麦克风识别、操作系统输入采集、直播平台或录制/导出链路。

摄像头演示基线为a049f6cad027da44ca82e04f8625c6ed8356857e，仍未修改产品代码。采用同一内置浏览器按1/12秒源时间取帧和GPL FFmpeg压缩方法。人物图片本身不说话、不运动；GIF展示正式合成器对静态人物源的布局与镜头变化，不作为真实摄像头、音画同步或编码导出的验收证据。生成提示词与其他README素材一起公开。
