import { readWaveInfo } from '../microphone-effects/wave';

/** Native audio is WAV; imported container audio retains FFmpeg's layout handling. */
export async function waveChannels(source: string): Promise<number | undefined> {
  try { return (await readWaveInfo(source)).channels; } catch { return undefined; }
}

export function stereoAudioFilter(channels?: number): string {
  // Browsers duplicate mono to both speakers at unity; FFmpeg's default uses -3 dB.
  return `${channels === 1 ? 'pan=stereo|c0=c0|c1=c0,' : ''}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo`;
}
