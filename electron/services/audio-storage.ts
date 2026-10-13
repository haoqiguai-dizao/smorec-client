import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { audioFileHash } from './audio-fingerprint';
import { floatPcmMetrics } from './audio-pcm-process';
import { runMicrophoneProcess } from './microphone-effects/process';
import { readWaveInfo, WAVPACK_RATES, type WaveInfo } from './microphone-effects/wave';

export interface AudioStorageMetadata { schema: 1; pcmHash: string; encodedHash: string; format: 'wavpack-float32' | 'wave-float32' }
async function wavePcmHash(file: string, info: WaveInfo, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file, { start: info.dataOffset, end: info.dataOffset + info.dataBytes - 1, signal })) hash.update(bytes);
  signal.throwIfAborted(); return hash.digest('hex');
}
async function waveStorage(file: string, pcmHash: string, signal: AbortSignal): Promise<AudioStorageMetadata> {
  return { schema: 1, pcmHash, encodedHash: await audioFileHash(file, signal), format: 'wave-float32' };
}
/** Short-lived mixes avoid a second whole-program compression pass on every volume change. */
export async function storeUncompressedFloatWave(file: string, info: WaveInfo, signal: AbortSignal): Promise<{ file: string; storage: AudioStorageMetadata }> {
  return { file, storage: await waveStorage(file, await wavePcmHash(file, info, signal), signal) };
}
/** The float samples are verified before publication. Unsupported/unprofitable compression keeps the original float WAV. */
export async function storeFloatWave(file: string, packed: string, executable: string, info: WaveInfo, signal: AbortSignal): Promise<{ file: string; storage: AudioStorageMetadata }> {
  const pcmHash = await wavePcmHash(file, info, signal);
  if (info.channels <= 2 && WAVPACK_RATES.includes(info.sampleRate)) {
    try {
      await runMicrophoneProcess(executable, ['-threads', '1', '-y', '-i', file, '-map', '0:a:0', '-vn',
        '-c:a', 'wavpack', '-sample_fmt', 'fltp', '-optimize_mono', '1', '-threads', '1', '-f', 'wv', packed], signal);
      const actual = await readWaveInfo(packed);
      if (actual.sampleRate !== info.sampleRate || actual.channels !== info.channels || actual.samples !== info.samples
        || (await floatPcmMetrics(executable, packed, actual, signal)).hash !== pcmHash) throw new Error('声音压缩回转验证失败');
      if ((await fs.stat(packed)).size < (await fs.stat(file)).size) {
        return { file: packed, storage: { schema: 1, pcmHash, encodedHash: await audioFileHash(packed, signal), format: 'wavpack-float32' } };
      }
    } catch (error) { if (signal.aborted) throw error; /* The verified float WAV remains usable. */ }
    await fs.rm(packed, { force: true });
  }
  return { file, storage: await waveStorage(file, pcmHash, signal) };
}
export async function validAudioStorage(file: string, storage: AudioStorageMetadata | undefined, signal: AbortSignal): Promise<boolean> {
  const info = await readWaveInfo(file);
  if (!storage) return info.storage !== 'wavpack';
  return storage.schema === 1 && /^[a-f0-9]{64}$/.test(storage.pcmHash) && /^[a-f0-9]{64}$/.test(storage.encodedHash)
    && storage.format === (info.storage === 'wavpack' ? 'wavpack-float32' : 'wave-float32')
    && await audioFileHash(file, signal) === storage.encodedHash;
}
