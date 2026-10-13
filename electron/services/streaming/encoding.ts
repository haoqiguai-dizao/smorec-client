import type { StreamProfile } from '../../../shared/streaming';
import { streamDestination } from './validation';
import type { RelayTransport } from './tls-relay';

export function streamArguments(profile: StreamProfile, width: number, height: number, audioURL: string, encoder: string, caFile?: string, transport?: RelayTransport): string[] {
  const server = transport?.server ?? profile.server;
  return ['-hide_banner', '-loglevel', 'warning', '-nostats', '-stats_period', '1', '-progress', 'pipe:1',
    '-probesize', '32', '-analyzeduration', '0', '-thread_queue_size', '8', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', audioURL,
    '-probesize', '32', '-analyzeduration', '0', '-thread_queue_size', '4', '-use_wallclock_as_timestamps', '1',
    '-f', 'rawvideo', '-pixel_format', 'bgra', '-video_size', `${width}x${height}`,
    '-framerate', String(profile.fps), '-i', 'pipe:0', '-map', '1:v:0', '-map', '0:a:0',
    '-c:v', encoder, ...(encoder === 'libx264' ? ['-preset', 'veryfast', '-tune', 'zerolatency', '-x264-params', 'nal-hrd=cbr:force-cfr=1'] : ['-realtime', '1', '-constant_bit_rate', 'true']),
    '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', String(profile.fps),
    '-profile:v', 'high', '-b:v', `${profile.bitrate}k`, '-maxrate', `${profile.bitrate}k`,
    '-minrate', `${profile.bitrate}k`, '-bufsize', `${profile.bitrate * 2}k`, '-g', String(profile.fps * profile.keyframeSeconds),
    '-keyint_min', String(profile.fps * profile.keyframeSeconds), '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-flvflags', 'no_duration_filesize', '-rw_timeout', '10000000',
    ...(/^rtmps:/i.test(server) ? ['-tls_verify', '1', ...(caFile ? ['-ca_file', caFile] : [])] : []),
    ...(transport ? ['-rtmp_tcurl', transport.tcUrl] : []),
    '-f', 'flv', streamDestination(server, profile.key)];
}
export function scrubStreamError(value: string, profile: StreamProfile): string {
  let result = value;
  for (const secret of [streamDestination(profile.server, profile.key), profile.server, profile.key,
    encodeURIComponent(profile.key)].filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('[已隐藏]');
  return result.replace(/(?:rtmps?|https?|socks5):\/\/[^\s\]]+/gi, '[地址已隐藏]').slice(-3000);
}
export function streamFailure(value: string): { message: string; retry: boolean } {
  if (/system proxy auth/i.test(value))
    return { message: '系统代理要求身份验证，请先在代理软件中完成验证', retry: false };
  if (/system proxy (unsupported|configuration)/i.test(value))
    return { message: '小录未能读取可用的系统代理配置，请重试', retry: false };
  if (/system proxy connect/i.test(value))
    return { message: '小录未能建立代理连接，请重试', retry: true };
  if (/certificate|cert.*verify|not trusted|hostname.*mismatch|tls.*handshake/i.test(value))
    return { message: '推流服务器证书验证失败，请检查地址和系统时间', retry: false };
  if (/unauthorized|forbidden|authentication|invalid.*key|not authorized|403|401/i.test(value))
    return { message: '平台拒绝推流，请检查地址、密钥和直播权限', retry: false };
  if (/unknown encoder|encoder.*not found|error.*opening encoder|unsupported.*codec|unrecognized option/i.test(value))
    return { message: '编码器不可用，请检查应用组件或降低画质', retry: false };
  if (/encoder output stalled/i.test(value))
    return { message: '推流编码输出已停止更新，请重试', retry: true };
  return { message: '小录未能连接平台，请重试', retry: true };
}
