import { spawn, type ChildProcess } from 'node:child_process';

export const MAX_BACKGROUND_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_BACKGROUND_PNG_BYTES = 64 * 1024 * 1024;
export const MAX_BACKGROUND_PIXELS = 16_777_216;
const active = new Set<ChildProcess>();
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function backgroundCodec(bytes: Buffer): 'png' | 'mjpeg' | 'webp' {
  if (!bytes.length || bytes.length > MAX_BACKGROUND_SOURCE_BYTES) throw new Error('背景图片不能超过 20 MB');
  if (bytes.subarray(0, 8).equals(pngSignature)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'mjpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('请选择有效的 PNG、JPEG 或 WebP 图片');
}

export function normalizedPngSize(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 33 || bytes.length > MAX_BACKGROUND_PNG_BYTES || !bytes.subarray(0, 8).equals(pngSignature)
    || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('背景图片解码失败');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > MAX_BACKGROUND_PIXELS)
    throw new Error('背景图片尺寸过大，单边不能超过 8192 像素，总像素不能超过 1677 万');
  return { width, height };
}

export function disposeBackgroundProcesses(): void { for (const child of active) child.kill(); }

export async function normalizeBackgroundImage(bytes: Buffer, executable?: string): Promise<Buffer> {
  const codec = backgroundCodec(bytes);
  const command = executable ?? (await import('./ffmpeg')).ffmpegPath();
  if (active.size >= 2) throw new Error('已有背景图片正在处理，请稍后重试');
  return new Promise((resolve, reject) => {
    // Only an explicitly selected raster codec and stdin pipe are available to the decoder.
    const child = spawn(command, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-max_alloc', '134217728',
      '-protocol_whitelist', 'pipe', '-f', 'image2pipe', '-c:v', codec, '-threads', '1',
      '-max_pixels', String(MAX_BACKGROUND_PIXELS), '-i', 'pipe:0', '-map', '0:v:0', '-frames:v', '1',
      '-an', '-sn', '-dn', '-map_metadata', '-1', '-threads', '1', '-c:v', 'png', '-pix_fmt', 'rgba', '-f', 'image2pipe', 'pipe:1'],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    active.add(child);
    const chunks: Buffer[] = [];
    let length = 0, failure: Error | undefined;
    const stop = (error: Error) => { failure ??= error; child.kill(); };
    const timer = setTimeout(() => stop(new Error('背景图片解码超时')), 20_000);
    child.stdout.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_BACKGROUND_PNG_BYTES) stop(new Error('背景图片解码后过大'));
      else if (!failure) chunks.push(chunk);
    });
    child.stderr.resume();
    child.stdin.on('error', () => { /* Decoder exit is handled only after the child is reaped. */ });
    child.once('error', error => { failure ??= error; });
    child.once('close', code => {
      clearTimeout(timer); active.delete(child);
      if (failure || code !== 0) { reject(failure ?? new Error('背景图片无效或无法解码')); return; }
      try {
        const png = Buffer.concat(chunks, length);
        normalizedPngSize(png);
        resolve(png);
      } catch (error) { reject(error); }
    });
    child.stdin.end(bytes);
  });
}
