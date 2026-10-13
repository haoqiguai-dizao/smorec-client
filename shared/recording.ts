export const RECORDING_RESOLUTIONS = ['native', '2160p', '1440p', '1080p'] as const;
export type RecordingResolution = typeof RECORDING_RESOLUTIONS[number];
export const RECORDING_RESOLUTION_LABELS: Record<RecordingResolution, string> = {
  native: '原始分辨率', '2160p': '4K', '1440p': '2K（推荐）', '1080p': '1080p（轻量）',
};
const edges: Record<RecordingResolution, number> = { native: 8192, '2160p': 3840, '1440p': 2560, '1080p': 1920 };

/** Match native capture: physical pixels, preserve aspect, never upscale or silently cap native. */
export function recordingOutputSize(width: number, height: number, resolution: RecordingResolution = 'native') {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2 || width > 16384 || height > 16384) {
    throw new Error('录制来源尺寸无效');
  }
  if (!RECORDING_RESOLUTIONS.includes(resolution)) throw new Error('录制分辨率不受支持');
  width = Math.floor(width / 2) * 2; height = Math.floor(height / 2) * 2;
  if (resolution === 'native' && Math.max(width, height) > edges.native) throw new Error('原始尺寸超过 8192 像素，请选择较低的录制分辨率');
  const scale = resolution === 'native' ? 1 : Math.min(1, edges[resolution] / Math.max(width, height));
  const output = { width: Math.floor(width * scale / 2) * 2, height: Math.floor(height * scale / 2) * 2 };
  if (output.width < 2 || output.height < 2) throw new Error('当前选区比例无法生成有效视频，请扩大选区或选择原始分辨率');
  if (output.width * output.height > 33_177_600) throw new Error('原始尺寸超过录制像素上限，请选择较低的录制分辨率');
  return output;
}
