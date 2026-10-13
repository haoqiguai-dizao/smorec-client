/** The shared offline mix limits actual peaks, without attenuating quiet inputs. */
export const AUDIO_MIX_HEADROOM_DB = -1;
export const AUDIO_MIX_PEAK = 10 ** (AUDIO_MIX_HEADROOM_DB / 20);

/** Sliders are literal track gains; peak protection belongs after summing. */
export function audioMixGains(volumes: readonly number[]): number[] {
  return volumes.map(value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
}
