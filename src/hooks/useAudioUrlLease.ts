import { useEffect } from 'react';
import { retainAudioUrl } from '../services/audio-url-leases';
export { releaseAudioUrl } from '../services/audio-url-leases';

/** Processing and playback hold independent references to the same opaque URL. */
export function useAudioUrlLease(url?: string, recorder = false): void {
  useEffect(() => retainAudioUrl(url, recorder), [url, recorder]);
}
