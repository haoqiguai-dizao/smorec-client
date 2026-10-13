import { audioMixGains } from '../../shared/audio-mix';
import type { Clip } from '../../shared/types';
import { stereoAudioFilter } from './project-audio/source';

/** Inputs start at index 1 because index 0 carries the renderer's IVF video. */
export function exportAudioFilters(volumes: readonly number[], clips: readonly Clip[], length: number, channels?: number): string {
  if (volumes.length !== 1) throw new Error('Resolve the shared project audio before cutting export clips');
  const filters: string[] = [];
  const gains = audioMixGains(volumes);
  gains.forEach((gain, track) => {
    const count = clips.length;
    if (count > 1) filters.push(`[${track + 1}:a:0]asplit=${count}${clips.map((_, i) => `[s${track}_${i}]`).join('')}`);
    clips.forEach((clip, i) => {
      const source = count > 1 ? `[s${track}_${i}]` : `[${track + 1}:a:0]`;
      filters.push(`${source}atrim=start=${clip.start.toFixed(6)}:end=${clip.end.toFixed(6)},asetpts=PTS-STARTPTS,${stereoAudioFilter(channels)}[c${track}_${i}]`);
    });
    filters.push(`${clips.map((_, i) => `[c${track}_${i}]`).join('')}concat=n=${count}:v=0:a=1,volume=${gain},apad,atrim=duration=${length.toFixed(6)}[a${track}]`);
  });
  filters.push('[a0]anull[outa]');
  return filters.join(';');
}
