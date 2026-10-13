import { normalizeMicrophoneEffects } from '../../../shared/microphone-effects';

export const MICROPHONE_PROCESSING_VERSION = 2;
export const dbGain = (db: number): number => 10 ** (db / 20);
const decimal = (value: number): string => value.toFixed(8);

/** Source-time processing: afftdn's two-hop latency is removed, with its tail supplied. */
export function microphoneFilterGraph(value: unknown, sampleRate: number, samples: number): string | undefined {
  const effects = normalizeMicrophoneEffects(value);
  if (!effects.enabled) return undefined;
  const filters: string[] = [];
  const delay = effects.noiseReduction === 'off' ? 0 : 2 * Math.floor(sampleRate / 80);
  if (effects.highpass.enabled) filters.push(`highpass=f=${effects.highpass.frequencyHz}:p=2`);
  if (delay) {
    filters.push(`apad=pad_len=${delay}`);
    filters.push(`afftdn=nr=${effects.noiseReduction === 'light' ? 6 : 12}:nf=-50:tn=1:gs=6`);
    filters.push(`atrim=start_sample=${delay}:end_sample=${samples + delay}`, 'asetpts=PTS-STARTPTS');
  }
  if (effects.eq.enabled) {
    if (effects.eq.lowDb) filters.push(`bass=g=${effects.eq.lowDb}:f=120:t=q:w=0.707`);
    if (effects.eq.presenceDb) filters.push(`equalizer=f=${Math.min(3000, sampleRate * .35)}:t=q:w=0.8:g=${effects.eq.presenceDb}`);
    if (effects.eq.airDb) filters.push(`treble=g=${effects.eq.airDb}:f=${Math.min(8000, sampleRate * .45)}:t=q:w=0.707`);
  }
  if (effects.autoLevel.enabled) {
    // RMS windows avoid changing individual vocal half-cycles. A linked, smoothed gain
    // lifts weak phrases but skips background frames below -54 dBFS; no soft clipping.
    filters.push(`dynaudnorm=f=200:g=7:p=0.8:m=${decimal(dbGain(effects.autoLevel.maxGainDb))}`
      + `:r=0.18:n=1:c=0:b=1:s=0:t=${decimal(dbGain(-54))}`);
  }
  if (effects.compression > 0) {
    const strength = effects.compression;
    filters.push(`acompressor=threshold=${decimal(dbGain(-12 - 12 * strength))}:ratio=${decimal(1 + 3 * strength)}`
      + `:attack=12:release=150:makeup=${decimal(effects.autoLevel.enabled ? 1 : dbGain(3 * strength))}:knee=2.82842712:detection=rms:link=maximum`);
  }
  if (effects.deEss > 0) filters.push(`deesser=i=${decimal(effects.deEss)}:m=${decimal(.25 + effects.deEss * .5)}:f=0.5`);
  if (effects.expander.enabled && effects.expander.ratio > 1) {
    filters.push(`agate=threshold=${decimal(dbGain(effects.expander.thresholdDb))}:ratio=${effects.expander.ratio}`
      + ':range=0.25118864:attack=5:release=120:makeup=1:knee=2.82842712:detection=rms:link=maximum');
  }
  if (effects.limiter.enabled) {
    filters.push(`alimiter=limit=${decimal(dbGain(effects.limiter.ceilingDb))}:attack=5:release=80:level=0:latency=1`);
  }
  if (!filters.length) return undefined;
  return ['asetpts=PTS-STARTPTS', ...filters, `apad=whole_len=${samples}`, `atrim=end_sample=${samples}`, 'asetpts=PTS-STARTPTS'].join(',');
}
