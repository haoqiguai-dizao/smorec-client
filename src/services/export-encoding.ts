// HEVC is implemented by Chromium before TypeScript's DOM declarations expose it.
export type ExportEncoderConfig = VideoEncoderConfig & { hevc?: { format: 'annexb' } };
/** hardware identifies the requested path; it is not proof of the browser's selected device. */
export interface ExportEncoding { codec: 'vp8' | 'h264' | 'hevc'; config: ExportEncoderConfig; hardware: boolean }

export async function chooseExportEncoding(width: number, height: number, fps: number, platform: string,
  probe: typeof VideoEncoder.isConfigSupported = config => VideoEncoder.isConfigSupported(config)): Promise<ExportEncoding> {
  const common = { width, height, framerate: fps, bitrate: Math.round(width * height * fps * 0.13), latencyMode: 'realtime' as const };
  if (platform === 'darwin' || platform === 'win32') {
    const config: VideoEncoderConfig = { ...common,
      codec: width * height > 4096 * 2304 ? 'avc1.64003e' : 'avc1.640034',
      hardwareAcceleration: 'prefer-hardware', avc: { format: 'annexb' } };
    try { if ((await probe(config)).supported) return { codec: 'h264', config, hardware: true }; }
    catch { /* Preserve the tested software path when the device cannot encode this size. */ }
  }
  if (platform === 'darwin') {
    // Apple Silicon can encode larger frames in HEVC than in H.264. Keep the
    // requested dimensions and avoid a software VP8 -> software H.264 transcode.
    const config: ExportEncoderConfig = { ...common,
      codec: width * height > 4096 * 2304 ? 'hvc1.1.6.L186.B0' : 'hvc1.1.6.L153.B0',
      hardwareAcceleration: 'prefer-hardware', hevc: { format: 'annexb' } };
    try {
      const result = await probe(config);
      // Unknown dictionary members are silently ignored. Length-prefixed HEVC
      // cannot be sent to the Annex B transport, even when the codec is supported.
      if (result.supported && (result.config as ExportEncoderConfig | undefined)?.hevc?.format === 'annexb')
        return { codec: 'hevc', config, hardware: true };
    } catch { /* Preserve the compatible fallback when HEVC is unavailable. */ }
  }
  const config: VideoEncoderConfig = { ...common, codec: 'vp8', hardwareAcceleration: 'prefer-software' };
  if (!(await probe(config)).supported) throw new Error(`当前系统不支持 ${width} × ${height} · ${fps} FPS 视频编码`);
  return { codec: 'vp8', config, hardware: false };
}
