import { app } from 'electron';
import path from 'node:path';
import { ffmpegPath } from './ffmpeg';
import { MicrophoneEffectsCache } from './microphone-effects/cache';
import { audioCacheManager } from './audio-cache';
import type { AudioCacheLease } from './audio-cache-manager';

let cache: MicrophoneEffectsCache | undefined;

/** Only trusted main-process project/trial paths may enter this service. */
export function resolveProcessedMicrophone(source: string, effects: unknown, signal?: AbortSignal, lease?: AudioCacheLease): Promise<string> {
  cache ??= new MicrophoneEffectsCache({ directory: path.join(app.getPath('userData'), 'cache', 'microphone-effects'), executable: ffmpegPath, maintenance: audioCacheManager() });
  return cache.resolve(source, effects, signal, lease);
}
export function cancelMicrophoneEffects(): void { cache?.cancelAll(); }
export function disposeMicrophoneEffects(): void { cache?.dispose(); cache = undefined; }
