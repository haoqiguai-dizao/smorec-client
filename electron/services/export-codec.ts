import type { ExportSettings } from '../../shared/types';

/** Codec transport owns the bitstream format; the exporter owns process/session lifetime. */
export function exportVideoTransport(settings: ExportSettings): { input: string[]; output: string[]; header?: Buffer } {
  if (settings.codec === 'h264' || settings.codec === 'hevc') return {
    input: ['-f', settings.codec, '-r', String(settings.fps)],
    // hvc1 stores parameter sets in the MP4 configuration for Apple/QuickTime compatibility.
    output: ['-c:v', 'copy', ...(settings.codec === 'hevc' ? ['-tag:v', 'hvc1'] : [])],
  };
  const header = Buffer.alloc(32);
  header.write('DKIF', 0); header.writeUInt16LE(0, 4); header.writeUInt16LE(32, 6);
  header.write('VP80', 8); header.writeUInt16LE(settings.width, 12); header.writeUInt16LE(settings.height, 14);
  header.writeUInt32LE(settings.fps, 16); header.writeUInt32LE(1, 20); header.writeUInt32LE(settings.frames, 24);
  return { input: ['-f', 'ivf'], output: ['-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p'], header };
}

/** IPC's 12-byte envelope is retained by IVF but must not enter an Annex B stream. */
export function exportVideoPayload(settings: ExportSettings, packet: Buffer): Buffer {
  if (settings.codec !== 'h264' && settings.codec !== 'hevc') return packet;
  const payload = packet.subarray(12);
  if (!(payload[0] === 0 && payload[1] === 0 && (payload[2] === 1 || payload[2] === 0 && payload[3] === 1)))
    throw new Error(`${settings.codec === 'hevc' ? 'HEVC' : 'H.264'} 视频帧格式无效`);
  return payload;
}
