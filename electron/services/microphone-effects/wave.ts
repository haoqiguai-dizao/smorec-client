import { promises as fs } from 'node:fs';
import { floatPcmMetrics } from '../audio-pcm-process';

export interface WaveInfo {
  sampleRate: number; channels: number; samples: number; bitsPerSample: number;
  encoding: number; blockAlign: number; dataOffset: number; dataBytes: number;
  storage?: 'wavpack';
}
export const WAVPACK_RATES = [6000, 8000, 9600, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000, 192000];

/** Read only bounded RIFF headers; never load a long recording into memory. */
export async function readWaveInfo(file: string): Promise<WaveInfo> {
  const input = await fs.open(file, 'r');
  try {
    const stat = await input.stat(), header = Buffer.alloc(12);
    const read = await input.read(header, 0, 12, 0);
    if (read.bytesRead === 12 && header.toString('ascii', 0, 4) === 'wvpk') {
      const block = Buffer.alloc(32);
      if ((await input.read(block, 0, 32, 0)).bytesRead !== 32) throw new Error('声音压缩文件头不完整');
      const flags = block.readUInt32LE(24), version = block.readUInt16LE(8), samples = block.readUInt32LE(12);
      const sampleRate = WAVPACK_RATES[(flags >>> 23) & 15], channels = flags & 4 ? 1 : 2;
      // Only our bounded mono/stereo float lossless files are adopted; other inputs retain WAV.
      if (version < 0x402 || version > 0x410 || block[10] || block[11] || block.readUInt32LE(16) !== 0
        || samples === 0 || samples === 0xffffffff || block.readUInt32LE(20) === 0 || !sampleRate || sampleRate < 8000
        || (flags & 0x1800) !== 0x1800 || !(flags & 0x80) || flags & 8 || flags & 0x80000000
        || (flags & 3) !== 3 || block.readUInt32LE(4) + 8 > stat.size || block.readUInt32LE(4) < 24) {
        throw new Error('声音压缩格式或长度无效');
      }
      return { sampleRate, channels, samples, encoding: 3, bitsPerSample: 32, blockAlign: channels * 4,
        dataOffset: -1, dataBytes: samples * channels * 4, storage: 'wavpack' };
    }
    if (read.bytesRead !== 12
      || !['RIFF', 'RF64'].includes(header.toString('ascii', 0, 4)) || header.toString('ascii', 8, 12) !== 'WAVE') {
      throw new Error('麦克风原片不是有效的 WAV 音频');
    }
    let offset = 12, format: Omit<WaveInfo, 'samples' | 'dataOffset' | 'dataBytes'> | undefined;
    let data: { dataOffset: number; dataBytes: number } | undefined, rf64Bytes: number | undefined;
    for (let chunks = 0; offset + 8 <= stat.size && chunks < 1024; chunks++) {
      const block = Buffer.alloc(8);
      if ((await input.read(block, 0, 8, offset)).bytesRead !== 8) break;
      const id = block.toString('ascii', 0, 4);
      let size = block.readUInt32LE(4);
      if (id === 'ds64' && size >= 28) {
        const sizes = Buffer.alloc(28); await input.read(sizes, 0, 28, offset + 8);
        rf64Bytes = Number(sizes.readBigUInt64LE(8));
      }
      if (id === 'data' && size === 0xffffffff && rf64Bytes !== undefined) size = rf64Bytes;
      if (!Number.isSafeInteger(size) || size < 0 || offset + 8 + size > stat.size) throw new Error('麦克风 WAV 音频数据不完整');
      if (id === 'fmt ' && size >= 16) {
        const bytes = Buffer.alloc(Math.min(size, 40)); await input.read(bytes, 0, bytes.length, offset + 8);
        const tag = bytes.readUInt16LE(0), encoding = tag === 0xfffe && bytes.length >= 40 ? bytes.readUInt16LE(24) : tag;
        format = { encoding, channels: bytes.readUInt16LE(2), sampleRate: bytes.readUInt32LE(4),
          blockAlign: bytes.readUInt16LE(12), bitsPerSample: bytes.readUInt16LE(14) };
      }
      if (id === 'data') data = { dataOffset: offset + 8, dataBytes: size };
      if (data && format) break;
      offset += 8 + size + (size % 2);
    }
    if (!format || !data || ![1, 3].includes(format.encoding) || format.channels < 1 || format.channels > 8
      || format.sampleRate < 8000 || format.sampleRate > 192000 || ![8, 16, 24, 32, 64].includes(format.bitsPerSample)
      || format.encoding === 3 && ![32, 64].includes(format.bitsPerSample)
      || format.blockAlign !== format.channels * format.bitsPerSample / 8
      || data.dataBytes === 0 || data.dataBytes % format.blockAlign !== 0) throw new Error('麦克风 WAV 采样格式或长度无效');
    return { ...format, ...data, samples: data.dataBytes / format.blockAlign };
  } finally { await input.close(); }
}

/** Float PCM peak verification also rejects decoder/processor NaN and infinity. */
export async function floatWavePeak(file: string, info: WaveInfo, signal?: AbortSignal, executable?: string): Promise<number> {
  if (info.encoding !== 3 || info.bitsPerSample !== 32) throw new Error('麦克风处理缓存格式不正确');
  if (info.storage === 'wavpack') {
    if (!executable) throw new Error('声音压缩文件需要解码器');
    return (await floatPcmMetrics(executable, file, info, signal)).peak;
  }
  const input = await fs.open(file, 'r');
  try {
    const bytes = Buffer.alloc(256 * 1024); let offset = 0, peak = 0;
    while (offset < info.dataBytes) {
      signal?.throwIfAborted();
      const length = Math.min(bytes.length, info.dataBytes - offset);
      const { bytesRead } = await input.read(bytes, 0, length, info.dataOffset + offset);
      if (bytesRead !== length) throw new Error('麦克风处理缓存数据不完整');
      for (let index = 0; index < length; index += 4) {
        const sample = bytes.readFloatLE(index);
        if (!Number.isFinite(sample)) throw new Error('麦克风处理产生了无效采样');
        peak = Math.max(peak, Math.abs(sample));
      }
      offset += length;
    }
    return peak;
  } finally { await input.close(); }
}
