import { promises as fs } from 'node:fs';
import { floatWavePeak as wavePeak, readWaveInfo, type WaveInfo } from '../../electron/services/microphone-effects/wave';
import { floatPcmStream } from '../../electron/services/audio-pcm-process';
import ffmpeg from 'ffmpeg-static';

export function floatWavePeak(file: string, info: WaveInfo, signal?: AbortSignal): Promise<number> {
  return wavePeak(file, info, signal, ffmpeg!);
}

export async function writeSyntheticWave(file: string, rate: number, channels: number, samples: number,
  signal: (frame: number, channel: number) => number): Promise<void> {
  const bytes = Buffer.alloc(44 + samples * channels * 4);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 4, 28);
  bytes.writeUInt16LE(channels * 4, 32); bytes.writeUInt16LE(32, 34); bytes.write('data', 36);
  bytes.writeUInt32LE(samples * channels * 4, 40);
  for (let frame = 0; frame < samples; frame++) for (let channel = 0; channel < channels; channel++) {
    bytes.writeFloatLE(signal(frame, channel), 44 + (frame * channels + channel) * 4);
  }
  await fs.writeFile(file, bytes);
}
export async function readSyntheticWave(file: string): Promise<{ rate: number; channels: Float32Array[] }> {
  const info = await readWaveInfo(file);
  let bytes: Buffer, start = info.dataOffset;
  if (info.storage === 'wavpack') {
    const decoded = await floatPcmStream(ffmpeg!, file, info), chunks: Buffer[] = [];
    try { for await (const chunk of decoded.stream) chunks.push(chunk as Buffer); }
    finally { decoded.stream.destroy(); await decoded.closed; }
    bytes = Buffer.concat(chunks); start = 0;
  } else bytes = await fs.readFile(file);
  const channels = Array.from({ length: info.channels }, () => new Float32Array(info.samples));
  for (let frame = 0; frame < info.samples; frame++) for (let channel = 0; channel < info.channels; channel++) {
    channels[channel][frame] = bytes.readFloatLE(start + (frame * info.channels + channel) * 4);
  }
  return { rate: info.sampleRate, channels };
}
export function rms(samples: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let index = start; index < end; index++) sum += samples[index] ** 2;
  return Math.sqrt(sum / (end - start));
}
export function peakIndex(samples: Float32Array, start: number, end: number): number {
  let result = start;
  for (let index = start + 1; index < end; index++) if (Math.abs(samples[index]) > Math.abs(samples[result])) result = index;
  return result;
}
