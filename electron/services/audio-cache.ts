import { app } from 'electron';
import path from 'node:path';
import { AudioCacheManager } from './audio-cache-manager';
let manager: AudioCacheManager | undefined;
export function audioCacheManager(): AudioCacheManager {
  manager ??= new AudioCacheManager(path.join(app.getPath('userData'), 'cache'));
  return manager;
}
export function disposeAudioCache(): void { manager?.dispose(); manager = undefined; }
