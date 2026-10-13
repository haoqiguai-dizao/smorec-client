const MAX_DURATION = 24 * 3600;
const PROBE_TOLERANCE = 0.1;

/** Only a finalized, internally consistent recording may extend the probed video. */
export function recoveryPresentationDuration(
  probedDuration: number, metadata: Record<string, unknown>, finalized: boolean,
): number {
  if (!finalized) return probedDuration;
  const { duration, videoDuration, tailHold } = metadata;
  if (typeof duration !== 'number' || !Number.isFinite(duration)
    || typeof videoDuration !== 'number' || !Number.isFinite(videoDuration)
    || typeof tailHold !== 'number' || !Number.isFinite(tailHold)) return probedDuration;
  if (duration <= probedDuration || duration > MAX_DURATION || videoDuration <= 0 || tailHold <= 0) return probedDuration;
  // FFmpeg's textual duration is rounded; metadata arithmetic itself must stay exact.
  if (Math.abs(videoDuration - probedDuration) > PROBE_TOLERANCE
    || Math.abs(duration - (videoDuration + tailHold)) > 0.000001) return probedDuration;
  return duration;
}
