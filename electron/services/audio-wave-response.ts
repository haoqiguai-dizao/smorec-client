import { Transform } from 'node:stream';
import { floatPcmStream } from './audio-pcm-process';
import { readWaveInfo, type WaveInfo } from './microphone-effects/wave';
import { audioReadable } from './audio-readable';

export function floatWaveHeader(info: Pick<WaveInfo, 'sampleRate' | 'channels' | 'samples'>): Buffer {
  const dataBytes = info.samples * info.channels * 4, large = dataBytes + 36 > 0xffffffff;
  const header = Buffer.alloc(large ? 80 : 44), format = large ? 48 : 12, data = large ? 72 : 36;
  header.write(large ? 'RF64' : 'RIFF', 0); header.writeUInt32LE(large ? 0xffffffff : dataBytes + 36, 4); header.write('WAVE', 8);
  if (large) {
    header.write('ds64', 12); header.writeUInt32LE(28, 16); header.writeBigUInt64LE(BigInt(dataBytes + 72), 20);
    header.writeBigUInt64LE(BigInt(dataBytes), 28); header.writeBigUInt64LE(BigInt(info.samples), 36);
  }
  header.write('fmt ', format); header.writeUInt32LE(16, format + 4); header.writeUInt16LE(3, format + 8);
  header.writeUInt16LE(info.channels, format + 10); header.writeUInt32LE(info.sampleRate, format + 12);
  header.writeUInt32LE(info.sampleRate * info.channels * 4, format + 16); header.writeUInt16LE(info.channels * 4, format + 20);
  header.writeUInt16LE(32, format + 22); header.write('data', data); header.writeUInt32LE(large ? 0xffffffff : dataBytes, data + 4);
  return header;
}
/** Present an immutable compressed cache as its original float WAV, including byte-accurate Range requests. */
export async function compressedWaveResponse(file: string, request: Request, executable: string,
  headers: Record<string, string>, release: () => void, signal = request.signal): Promise<Response> {
  let transferred = false;
  try {
    const info = await readWaveInfo(file); if (info.storage !== 'wavpack') throw new Error('声音缓存不是压缩音频');
    const header = floatWaveHeader(info), size = header.length + info.dataBytes, range = request.headers.get('range');
    let start = 0, end = size - 1, status = 200;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Type'] = 'audio/wav'; headers['Content-Length'] = String(end - start + 1);
    headers['Cache-Control'] = 'no-store';
    if (request.method === 'HEAD') return new Response(null, { status, headers });
    if (end < header.length) return new Response(new Uint8Array(header.subarray(start, end + 1)), { status, headers });
    const alignment = info.channels * 4, from = Math.max(0, start - header.length), firstFrame = Math.floor(from / alignment);
    let skip = from - firstFrame * alignment, remaining = end - Math.max(header.length, start) + 1;
    const frames = Math.ceil((remaining + skip) / alignment);
    const decoder = await floatPcmStream(executable, file, info, firstFrame, frames, signal);
    const slice = new Transform({ highWaterMark: 64 * 1024, transform(bytes: Buffer, _encoding, done) {
      const trim = Math.min(skip, bytes.length); skip -= trim;
      const data = bytes.subarray(trim, trim + remaining); remaining -= data.length; done(null, data);
    } });
    slice.on('error', () => {});
    if (start < header.length) slice.push(header.subarray(start));
    decoder.stream.once('error', error => slice.destroy(error)); decoder.stream.pipe(slice);
    slice.once('close', () => decoder.stream.destroy());
    try {
      const response = new Response(audioReadable(slice), { status, headers });
      transferred = true; void decoder.closed.finally(release); return response;
    } catch (error) { slice.destroy(); await decoder.closed; throw error; }
  } finally { if (!transferred) release(); }
}
