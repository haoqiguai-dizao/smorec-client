export type MicrophonePreset = 'original' | 'natural' | 'clear' | 'warm';
export type MicrophoneNoiseReduction = 'off' | 'light' | 'moderate';
export interface MicrophoneEffects {
  preset: MicrophonePreset;
  enabled: boolean;
  noiseReduction: MicrophoneNoiseReduction;
  autoLevel: { enabled: boolean; maxGainDb: number };
  compression: number;
  deEss: number;
  highpass: { enabled: boolean; frequencyHz: number };
  /** Fixed 120 Hz low shelf, 3 kHz presence bell (Q=0.8), 8 kHz high shelf. */
  eq: { enabled: boolean; lowDb: number; presenceDb: number; airDb: number };
  /** Downward RMS expansion, 5 ms attack, 120 ms release, at most 12 dB reduction. */
  expander: { enabled: boolean; thresholdDb: number; ratio: number };
  /** Sample-peak ceiling; lookahead is compensated and automatic makeup is disabled. */
  limiter: { enabled: boolean; ceilingDb: number };
}

export const MICROPHONE_PRESETS = [
  { id: 'original', label: '原声' }, { id: 'natural', label: '自然口播' },
  { id: 'clear', label: '清晰讲解' }, { id: 'warm', label: '温暖播客' },
] as const;

export const ORIGINAL_MICROPHONE_EFFECTS: Readonly<MicrophoneEffects> = {
  preset: 'original', enabled: false, noiseReduction: 'off', compression: 0, deEss: 0,
  autoLevel: { enabled: false, maxGainDb: 12 },
  highpass: { enabled: false, frequencyHz: 80 },
  eq: { enabled: false, lowDb: 0, presenceDb: 0, airDb: 0 },
  expander: { enabled: false, thresholdDb: -45, ratio: 1.5 },
  limiter: { enabled: false, ceilingDb: -1 },
};
export const DEFAULT_MICROPHONE_EFFECTS: Readonly<MicrophoneEffects> = {
  preset: 'natural', enabled: true, noiseReduction: 'light', compression: .3, deEss: .2,
  autoLevel: { enabled: true, maxGainDb: 12 },
  highpass: { enabled: true, frequencyHz: 70 },
  eq: { enabled: true, lowDb: 0, presenceDb: 1, airDb: 0 },
  expander: { enabled: true, thresholdDb: -48, ratio: 1.4 },
  limiter: { enabled: true, ceilingDb: -1 },
};

export function microphonePreset(id: MicrophonePreset): MicrophoneEffects {
  const base = id === 'original' ? ORIGINAL_MICROPHONE_EFFECTS : DEFAULT_MICROPHONE_EFFECTS;
  const result = structuredClone(base) as MicrophoneEffects;
  result.preset = id;
  if (id === 'clear') {
    result.compression = .45; result.deEss = .35; result.highpass.frequencyHz = 90;
    result.eq = { enabled: true, lowDb: -1, presenceDb: 2.5, airDb: .5 };
  } else if (id === 'warm') {
    result.compression = .4; result.deEss = .25; result.highpass.frequencyHz = 60;
    result.eq = { enabled: true, lowDb: 2, presenceDb: .5, airDb: -.5 };
  }
  return result;
}

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const number = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const boolean = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback;

/** Missing legacy fields stay bypassed; callers choose natural defaults only for new recordings. */
export function normalizeMicrophoneEffects(value: unknown, fallback: Readonly<MicrophoneEffects> = ORIGINAL_MICROPHONE_EFFECTS): MicrophoneEffects {
  const input = record(value), highpass = record(input.highpass), eq = record(input.eq);
  const autoLevel = record(input.autoLevel);
  const expander = record(input.expander), limiter = record(input.limiter);
  return {
    preset: MICROPHONE_PRESETS.some(preset => preset.id === input.preset) ? input.preset as MicrophonePreset : fallback.preset,
    enabled: boolean(input.enabled, fallback.enabled),
    noiseReduction: typeof input.noiseReduction === 'string' && ['off', 'light', 'moderate'].includes(input.noiseReduction)
      ? input.noiseReduction as MicrophoneNoiseReduction : fallback.noiseReduction,
    autoLevel: { enabled: boolean(autoLevel.enabled, fallback.autoLevel.enabled),
      maxGainDb: number(autoLevel.maxGainDb, fallback.autoLevel.maxGainDb, 0, 18) },
    compression: number(input.compression, fallback.compression, 0, 1),
    deEss: number(input.deEss, fallback.deEss, 0, 1),
    highpass: { enabled: boolean(highpass.enabled, fallback.highpass.enabled),
      frequencyHz: number(highpass.frequencyHz, fallback.highpass.frequencyHz, 40, 200) },
    eq: { enabled: boolean(eq.enabled, fallback.eq.enabled), lowDb: number(eq.lowDb, fallback.eq.lowDb, -6, 6),
      presenceDb: number(eq.presenceDb, fallback.eq.presenceDb, -6, 6), airDb: number(eq.airDb, fallback.eq.airDb, -6, 6) },
    expander: { enabled: boolean(expander.enabled, fallback.expander.enabled),
      thresholdDb: number(expander.thresholdDb, fallback.expander.thresholdDb, -60, -20),
      ratio: number(expander.ratio, fallback.expander.ratio, 1, 4) },
    limiter: { enabled: boolean(limiter.enabled, fallback.limiter.enabled),
      ceilingDb: number(limiter.ceilingDb, fallback.limiter.ceilingDb, -12, -1) },
  };
}
