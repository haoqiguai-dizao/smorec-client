import { AUDIO_MIX_PEAK, audioMixGains } from '../../../shared/audio-mix';
import { stereoAudioFilter } from './source';

export const PROJECT_AUDIO_VERSION = 1;
export const PROJECT_AUDIO_RATE = 48000;

/** Limit once on the source timeline, so cuts and seeks cannot reset the envelope. */
export function projectAudioFilters(volumes: readonly number[], samples: number, channels: readonly (number | undefined)[] = []): string {
  const gains = audioMixGains(volumes);
  if (gains.length !== 2 || !Number.isSafeInteger(samples) || samples < 1) throw new Error('Invalid project audio mix');
  const inputs = gains.map((gain, index) => `[${index}:a:0]asetpts=PTS-STARTPTS,${stereoAudioFilter(channels[index])},`
    + `volume=${gain},apad,atrim=end_sample=${samples}[a${index}]`);
  return [...inputs, `[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,`
    + `alimiter=limit=${AUDIO_MIX_PEAK}:attack=5:release=50:level=0:latency=1,`
    + `apad,atrim=end_sample=${samples}[outa]`].join(';');
}
