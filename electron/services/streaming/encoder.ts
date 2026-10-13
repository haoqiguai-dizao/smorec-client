import { execFile } from 'node:child_process';

export async function chooseStreamEncoder(executable: string, width: number, height: number, fps: number, bitrate: number, platform = process.platform): Promise<string> {
  if (platform !== 'darwin') return 'libx264';
  // Verify the actual hardware path; presence in -encoders alone does not prove initialization.
  return new Promise(resolve => execFile(executable, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', `color=s=${width}x${height}:r=${fps}`, '-frames:v', '1', '-c:v', 'h264_videotoolbox',
    '-realtime', '1', '-constant_bit_rate', 'true', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-b:v', `${bitrate}k`, '-f', 'null', '-'],
  { windowsHide: true, timeout: 6000, maxBuffer: 16384 }, error => resolve(error ? 'libx264' : 'h264_videotoolbox')));
}
