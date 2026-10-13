import { audioMixGains } from '../../shared/audio-mix';

type AudioLevels = { system: number; microphone: number };
type VolumeElement = Pick<HTMLMediaElement, 'volume'>;
export type PreviewAudioTracks = { system?: VolumeElement; microphone?: VolumeElement; mix?: VolumeElement };

/** Apply the same gain staging as export; the original media and slider values stay intact. */
export function applyPreviewAudioMix(video: VolumeElement & Pick<HTMLMediaElement, 'muted'>, tracks: PreviewAudioTracks, levels: AudioLevels): void {
  if (tracks.mix) {
    video.muted = true; video.volume = 0; tracks.mix.volume = 1;
    if (tracks.system) tracks.system.volume = 0;
    if (tracks.microphone) tracks.microphone.volume = 0;
    return;
  }
  const embedded = !tracks.system && !tracks.microphone;
  const [system, microphone] = audioMixGains([
    tracks.system || embedded ? levels.system : 0,
    tracks.microphone ? levels.microphone : 0,
  ]);
  video.muted = !embedded;
  video.volume = embedded ? system : 0;
  if (tracks.system) tracks.system.volume = system;
  if (tracks.microphone) tracks.microphone.volume = microphone;
}
