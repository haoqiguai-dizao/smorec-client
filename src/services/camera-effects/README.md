# 摄像头画面处理

本轮变化、预设与实测结果见美颜升级记录（内部历史资料未纳入本快照）。

`new CameraEffectsRenderer().render(source, effects)` 接受 Canvas、视频、ImageBitmap 和 VideoFrame 等 CanvasImageSource。禁用或所有肤质、五官及滤镜强度均为 0 时原样返回 source；启用时返回处理器自身复用的画布，保持完整的内在显示尺寸。1080p 输入仍输出 1920×1080，不先将全图降采样再放大。返回画面在下一次 render／dispose 前有效。调用方应各自持有一个实例，结束时 dispose，不共享或改写处理器的输出画布。

`face/` 模块实现离线 478 点定位与 12 项面部分区参数。`tracker.ts` 在经典 Worker 中懒加载本地模型，预览使用 VIDEO 跟踪模式，每秒最多发起 15 次推理、最多一个在途请求；逐帧导出使用 IMAGE 模式保持确定性；`continuity.ts` 区分推理延迟和真正丢失：美白/红润短暂保留，240–480ms 内平滑退出，恢复渐入；形变和眼牙区域仍按原始定位年龄更早退出。切源、跳转或长间断会清空历史，迟到回复不能进入新时间段。`geometry.ts` 根据当前定位生成形变和区域；`processor.ts` 先执行独立 GPU/CPU 五官通道，再交给肤质通道。GPU 路径按五官、肤质顺序处理，两个步骤共用同一上下文，中间使用预乘 RGBA8 纹理。`face/shader.ts` 与 `face/kernel.ts` 对齐公式。导出必须先 `await renderer.prepare(source, effects)`，或调用 `prepareWebcamEffects`；不能把预览的异步定位方式直接用于导出。`usePreview` 与 `useCameraEffectPreview` 监听定位完成事件，重绘暂停帧。模型故障由界面展示，导出异常会向调用方抛出。

导出只为可见的摄像头帧准备效果，包含全局关闭但局部显示的情况。有面部参数时提前准备最多三个输出帧，每路四张池化画布；其余路径仍提前一帧、每路两张画布。`face/preparation.ts` 只保留一个 CPU IMAGE 模型和最多四份准确帧结果，相同源帧的在途请求也复用。池槽不同但源实例和真实帧时间戳相同，可以复用准确的人脸结果与效果画面，不能仅依赖画布对象相等判断。同帧参数改变重新绘制，缺少帧标记时仍每次识别。开发状态与待验收项见 导出性能（内部历史资料未纳入本快照）。

并行预取时必须向 `prepareWebcamEffects` 传递输出帧序号：屏幕隐藏切换可能让后续摄像头帧先完成解码，缓存按输出序号而非请求到达顺序淘汰。重复源帧的保留序号延长到最新输出位置，避免剪辑复用同一源帧时提前删除尚需使用的定位结果。串行调用可省略序号。

已归一化的 Canvas 直接上传一次并完成 GPU 美颜；视频、VideoFrame、ImageBitmap 等媒体仍先经过私有暂存画布，保留原有方向、裁剪与色彩转换。处理保持完整内在显示尺寸，不依赖窗口大小或 devicePixelRatio。不同源帧即使共用 Canvas 对象，也必须上传当前像素；只有准确帧身份和参数同时相同时才能复用最终结果。

`face/bounds.ts` 求旋转人脸椭圆、全部五官多边形和各形变支撑圆的保守包围范围。范围外的形变和面部颜色权重必为零，shader 直接采样原像素，避免对整张 4K 图执行五官多边形循环。边界包含形变位移和浮点余量，不缩小素材、输出或模型输入，不裁去任何有效效果。GPU 丢失恢复时直接丢弃已失效的旧句柄；不能在恢复后的上下文里删除旧对象，否则可能污染 GL 错误状态。

磨皮保留亮度归一化 YCbCr 肤色色域权重，对浅色、深色、低光与偏冷肤色进行柔和选区；中性灰、纯黑白及明显的蓝绿纹理不参与处理。升级算法从原来的单次 3×3 邻域改为双尺度双边采样：3×3 细节层与 5×5 肤色基底层。在基底中平滑细小斑驳，再回加 22% 的亮度高频残差；较大的高频残差会减弱磨皮。回加结果限制在原像素与基底的色值范围内，避免锐化过冲和亮边。色差截止仍用于保留硬边。

细节层采样步长为 `max(1, 长边/1920)`；肤色基底步长为 `max(1, 长边/320)`，5×5 核使用可分离二项式权重 `[1,4,6,4,1]` 的乘积。1080p 两层步长分别为 1 与 6 像素，基底覆盖半径 12 像素；不缩小输出画面。GPU 在同一个绘制通道内完成两个尺度，启用磨皮最多 34 次邻域采样，关闭磨皮时跳过邻域计算。CPU 对整数坐标直接读取，分数坐标使用预乘 alpha 双线性采样，与 GPU 同核。

磨皮强度曲线保持 `0.9 * s * (1 + 0.35 * (1 - s))`，0% 完全不处理。肤质算法只依赖当前帧，没有历史帧混合。肤色权重仍是颜色启发式，可能处理相近颜色的背景；它与独立的人脸定位／五官通道分开，不能把高频保护当作人脸识别。

提亮使用 `gain = 2^(1.5 * brightness)`、`c' = c * gain / (1 + c * (gain - 1))` 的有理曝光映射。它重点提升暗部与中间调，0 保黑、1 保白，不通过全图叠白提亮。自然滤镜使用适量饱和度、端点保护的 S 曲线与轻暖调；暖调、冷调使用中间调加权的色温偏移；黑白按亮度转换。全部滤镜均通过 intensity 与处理前颜色混合，0% 完全不变。新默认改为 45% 磨皮、12% 提亮和 18% 自然滤镜。已有用户偏好和工程参数不迁移，但启用效果后会使用新版算法，因此旧参数的观感可能改变。没有效果字段的旧工程仍保持原图。

GPU 与 CPU 使用相同公式和归一化采样范围，数值参数来自同一份 `parameters.ts`，shader 在构建时由这些常量生成。邻居插值使用预乘 alpha，之后还原直通 RGB 计算色差，避免透明邻居的 RGB 污染边缘；原始 alpha 保留。

GPU 仅在第一次启用时创建 context、shader、program、buffer 和 texture。尺寸变化时重新分配纹理存储，连续同尺寸帧只上传像素、更新 uniform 并绘制。shader 链接后释放；dispose 显式释放 GPU 资源。context lost 时阻止默认放弃恢复的行为，当前帧切换 CPU；恢复事件重新创建失效资源。GPU 不可用或失败时继续执行 CPU 同核，不返回未经处理的帧。暂存、输出画布和 CPU 输出缓冲均按实例复用。

`renderer.backend` 只读属性表示最近完成帧的 `bypass`、`gpu` 或 `cpu` 路径。实时预览按 CPU 绘制耗时至少让出等长空档，且最多绘制 15 fps；CPU 回退不再额外降低包装器传入的像素尺寸，不修改原始摄像头轨道。实时预览包装器按显示区域与 DPR 选择输入大小，GPU／原图显示受现有 30 fps 预算约束。导出不使用这一预览节流策略，逐帧执行同一完整分辨率算法。CPU 回退的单帧耗时仍取决于源分辨率和肤色覆盖率。

运行 `npx tsx --test tests/camera-effects-quality.test.ts` 可验证真实媒体尺寸、关闭效果的直接返回、1080p 单像素高频细节、肤色噪声与深色细线、整数／分数采样透明度，以及 CPU 预览预算。这些测试只使用内存中的合成像素，不访问设备。

运行 `npx tsx --test tests/camera-effects-strength.test.ts` 可单独验证 0%／25%／67%／100% 的强度曲线。确定性合成肤色噪声在五种明暗／色温样本上的方差比例约为 1／0.669／0.325／0.186；测试要求 67% 至少降低 50% 方差，同时黑色单像素细线、肤色硬边及非肤色纹理逐字节保留。曝光测试检查灰阶单调性、纯黑白端点与不超过 1% 的高光裁切率（包含原始白色）；滤镜测试检查强度单调性和可测的 RGB 变化。原有默认 1080p 单像素黑白对比不低于 240 的断言保留。这些是合成信号质量指标，不等同真实人物的审美评价。

摄像头默认“自动（优先流畅）”，在采集端限制最高 1080p、30 FPS，屏幕录制规格独立。旧原始分辨率偏好迁移为自动，已有明确的 4K／2K／1080p 与 60 FPS 选择保留。自动模式允许较低的设备原生尺寸，显式分辨率使用精确约束且禁止裁切插值。连接重试后仍检查实际规格，设备忽略自动上限时报错，不带着 4K／60 FPS 继续录制。帧率兼容重试保持同一设备及像素上限，权限或设备不存在不会触发换设备。界面显示原始采集 track 的实际尺寸与帧率，不把 USB 摄像头输出等同机内录像规格。原片按实际像素和帧率设置 4–80 Mbps 编码预算，1080p30 约 8 Mbps。独立浮窗 WebRTC 按显示矩形、DPR 与 cover 需求分配传输尺寸和码率，最高 30 fps，口播大窗按需要恢复完整源尺寸；没有固定的 480 像素上限。隐藏时只停止独立 sender 的预览编码，原片直接录制采集流，不经过浮窗或美颜画布，原始约束与 MediaRecorder 保持不变。

运行 `node scripts/verify-camera-quality.mjs` 会在独立 Electron profile 中使用 Canvas 合成流，拒绝全部真实设备权限。它检查真实 WebRTC 720p／1080p 接收尺寸、细条纹对比、关闭浮窗后继续保存的原片尺寸与细节，以及完整 1080p 美颜的 GPU／强制 CPU 像素一致性。强度检查另包含磨皮、提亮和四种滤镜各 0%／25%／67%／100% 的 24 组，以及 4 种滤镜的分数采样半径组合。各组均对照真实 WebGL 与生产 CPU 回退，验证五种肤色噪声、黑色细线、非肤色细节和 alpha；透明像素比较预乘后的视觉色差，避免将透明 RGB 的无效数值当成画面误差。

报告和可查看的合成 PNG 位于 `output/camera-quality-verification/`，其中 `effects-strength-contact-sheet.png` 按行展示磨皮、提亮、自然、暖调、冷调、黑白，按列展示 0%／25%／67%／100%。每格上方五条为浅色、中等、深色、低光与偏冷肤色噪声，下方为黑白细纹、灰阶、alpha 和非肤色纹理；该图不含真人或用户截图。只设置 `scaleResolutionDownBy: 1` 仍可能被浏览器自适应降清晰度，因此 WebRTC 测试检查实际解码尺寸，而不是仅检查编码参数。

输出从 GPU 画布同步复制到私有 2D 画布，再返回调用方。这样可以关闭 preserveDrawingBuffer，并避免 WebGL 在返回后清空绘制缓冲造成黑帧。调用方的 2D 状态与源画面不被修改。

纹理 NPOT 设置、上下文行为及资源生命周期参考 [Khronos WebGL 规范](https://registry.khronos.org/webgl/specs/latest/1.0/)、[MDN WebGL 最佳实践](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) 和 [WebCodecs 的 VideoFrame 显示尺寸定义](https://www.w3.org/TR/webcodecs/)。GPU 错误同步检查只在存储分配后执行，避免逐帧 getError／getParameter 的同步开销。

历史独立合成像素验证脚本保存在开发机 `output/camera-effects-verification/run.mjs`，结果为同目录 `report.json`，不访问真实设备。这些本地历史证据不随仓库分发。该次验证包含四种滤镜的 GPU／CPU 对照、轻深肤色噪声与非肤色细节、硬边、alpha、方向、VideoFrame／视频尺寸、同对象新帧上传以及强制 context lost／恢复。该结果用于核验算法，不等同真实人物审美评价或所有驱动的性能验证。

## 预设与模块

界面提供自然肤质（45/12/18）、细腻柔肤（75/14/15）和明亮上镜（65/32/20）三档；数字分别是磨皮、提亮、自然滤镜强度。选择预设提交普通 CameraEffects 字段，并开启效果；手动调整后自动取消预设选中态。按住看原图只改变临时显示，不写入参数。恢复自然回到新版默认；禁用整个控件时，预设同样不可点击。

- `skin.ts`：肤色权重与标量函数。
- `sampling.ts`：预乘透明度双线性采样。
- `skin-smoothing.ts`：多尺度肤色与高频细节处理。
- `kernel.ts`：CPU 像素流程、曝光和滤镜组合。
- `shader.ts` / `gpu.ts`：同核 WebGL 程序与资源管理。
- `shared/camera-effects.ts`：预设、默认值和效果时间线。
- `shared/beauty.ts`：新增字段与双向范围；缺失字段按零解释。
- `face/worker.ts`、`face/tracker.ts`：本地模型、异步调度、过期定位与资源生命周期。
- `face/geometry.ts`、`face/processor.ts`、`face/kernel.ts`、`face/shader.ts`：局部形变、肤色／眼白／牙齿区域与 GPU/CPU 两条路径。
- `scripts/prepare-beauty.mjs`：构建时校验模型、复制运行库并打包经典 Worker；运行时无 CDN。

## 参考与验收

本次独立实现参考 [GPUPixel 的美颜滤镜组合](https://github.com/pixpark/gpupixel/blob/main/src/filter/beauty_face_filter.cc)、[高频细节恢复](https://github.com/pixpark/gpupixel/blob/main/src/filter/beauty_face_unit_filter.cc) 及 [YUCIHighPassSkinSmoothing 的频率分离说明](https://github.com/YuAo/YUCIHighPassSkinSmoothing)。借鉴基底平滑与细节恢复的处理思路，没有直接引入它们的原生运行库、模型或 LUT 素材。

新增 `node --import tsx --test tests/camera-beauty-quality.test.ts` 验证多像素瑕疵、细纹残留、低频面部明暗和预设序列化；原有颜色、透明度、元数据、保存重开和像素一致性检查继续保留。

`node scripts/verify-beauty-upgrade.mjs` 使用独立 Electron profile，拒绝所有真实设备权限。它比较公开真人样片的原图、固定历史算法相同强度、新算法相同强度及新默认预设，并生成局部放大图；另检查控件交互、尺寸变化、GPU context lost/恢复、720p/1080p/4K 的渲染耗时。性能计时包含强制像素读回后的 GPU 同步，不能仅以提交 draw 的耗时声称实时帧率。报告及图像保存在 `output/beauty-upgrade/`。

首次运行需要将以下公开测试图像放在 `output/beauty-upgrade/fixtures/`，仅用于开发验证，不随应用分发：

- [Grace Hopper / Matplotlib sample data](https://raw.githubusercontent.com/matplotlib/matplotlib/main/lib/matplotlib/mpl-data/sample_data/grace_hopper.jpg)，文件名 `grace_hopper.jpg`。
- [Eileen Collins / scikit-image astronaut](https://raw.githubusercontent.com/scikit-image/scikit-image/v0.25.2/skimage/data/astronaut.png)，文件名 `astronaut.png`；[来源说明](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut)。

真人样片用于检查效果方向和纹理边界，不能替代不同设备、光线、肤色和连续录像的全面验收；CPU 全分辨率回退以正确性为先，不能保证实时帧率。

## 连续画面与外接相机修复（2026-09-20）

预览传输按实际窗口物理像素编码，优先协商 H.264 并保留平台支持的回退编码；只调整 30/24/20/15 FPS 档位，不再叠加分辨率与码率降级。录制原片继续使用独立 MediaRecorder。运行时编码器是否硬件加速必须由实际统计验证，不能仅凭 MIME 判定。完整修复范围、官方依据与验证边界见 连续摄像头验收（内部历史资料未纳入本快照）。
