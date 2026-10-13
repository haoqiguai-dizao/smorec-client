export const AUDIO_CACHE_POLICY = {
  maxBytes: 2 * 1024 ** 3,
  targetBytes: 1.5 * 1024 ** 3,
  maxIdleMs: 30 * 24 * 60 * 60 * 1000,
  recentMs: 5 * 60 * 1000,
  abandonedMs: 24 * 60 * 60 * 1000,
} as const;
export interface AudioCacheSnapshot {
  totalBytes: number; clearableBytes: number; protectedBytes: number; inUseBytes: number;
  microphoneBytes: number; mixBytes: number; budgetBytes: number; idleDays: number;
  warnings: string[];
}
export interface AudioCacheCleanup { freedBytes: number; removedFiles: number; snapshot: AudioCacheSnapshot }
export interface AudioCacheApi {
  state(): Promise<AudioCacheSnapshot>;
  clear(): Promise<AudioCacheCleanup>;
}
export function formatAudioCacheBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[index]}`;
}
declare global { interface Window { audioCache?: AudioCacheApi } }
