import type { Project } from '../../shared/types';
import { AUDIO_MIX_PEAK, audioMixGains } from '../../shared/audio-mix';
import { PreviewAudioTrack } from './preview-audio-track';

export type PreviewAudioElements = Record<string, HTMLAudioElement>;
export interface PreparedPreviewAudio { mixed: boolean; url?: string; microphoneUrl?: string; ready: boolean }

/** Warm stems keep levels immediate; effect edits retain confirmed audio until its replacement is playable. */
export class PreviewAudioSession {
  readonly tracks: PreviewAudioElements = {};
  original = false;
  private system: PreviewAudioTrack;
  private microphone: PreviewAudioTrack;
  private mix: PreviewAudioTrack;
  private project?: Project;
  private prepared?: PreparedPreviewAudio;
  private video?: HTMLVideoElement;
  private identity?: string;
  private mixScopes = new Map<string, string>();
  private requestedMix?: string;
  private updating = false;
  constructor(sourceTime: () => number, onError: (message: string) => void,
    create: () => HTMLAudioElement = () => new Audio(), private changed: () => void = () => {},
    retain: (url: string) => () => void = () => () => {}) {
    const refresh = () => { if (!this.updating) this.refresh(true); };
    this.system = new PreviewAudioTrack('system', this.tracks, sourceTime, refresh, onError, create, retain);
    this.microphone = new PreviewAudioTrack('microphone', this.tracks, sourceTime, refresh, onError, create, retain);
    this.mix = new PreviewAudioTrack('mix', this.tracks, sourceTime, refresh, onError, create, retain);
  }

  update(project: Project, prepared: PreparedPreviewAudio, playing: boolean): void {
    const identity = JSON.stringify([project.id, project.media]);
    if (identity !== this.identity) { this.dispose(); this.identity = identity; }
    this.project = project; this.prepared = prepared; this.updating = true;
    this.system.update(project.media.systemAudio, playing);
    this.microphone.update(prepared.microphoneUrl ?? (!prepared.mixed ? prepared.url : undefined) ?? project.media.microphone, playing);
    const scope = this.mixScope(project);
    if (prepared.mixed && prepared.ready && prepared.url) this.mixScopes.set(prepared.url, scope);
    // Effect-only edits keep the confirmed mix until replacement decoding completes.
    // Different levels, media, project or duration must never retain an old audible mix.
    const retained = this.mix.url && this.mixScopes.get(this.mix.url) === scope ? this.mix.url : undefined;
    this.requestedMix = prepared.mixed ? prepared.ready ? prepared.url : retained : undefined;
    this.mix.update(this.requestedMix, playing);
    this.updating = false; this.refresh();
  }

  private mixScope(project: Project): string {
    return JSON.stringify([project.id, project.media, project.duration, audioMixGains([project.audio.system, project.audio.microphone])]);
  }

  applyLevels(video: HTMLVideoElement, levels: Project['audio']): void {
    this.video = video;
    if (this.project) this.project = { ...this.project, audio: levels };
    this.refresh();
  }

  private refresh(smooth = false): void {
    const project = this.project, prepared = this.prepared;
    if (!project || !prepared) return;
    const mixed = !!prepared.mixed && this.mix.ready && this.mixScopes.get(this.mix.url!) === this.mixScope(project);
    for (const url of this.mixScopes.keys()) if (url !== this.mix.url && url !== this.requestedMix) this.mixScopes.delete(url);
    const [system, microphone] = audioMixGains([project.audio.system, project.audio.microphone]);
    const separate = !!project.media.systemAudio || !!project.media.microphone;
    const total = (project.media.systemAudio ? system : 0) + (project.media.microphone ? microphone : 0);
    const scale = project.media.systemAudio && project.media.microphone && system > 0 && microphone > 0
      && total > AUDIO_MIX_PEAK ? AUDIO_MIX_PEAK / total : 1;
    this.system.setGain(mixed ? 0 : system * scale, smooth);
    this.microphone.setGain(mixed ? 0 : microphone * scale, smooth);
    this.mix.setGain(mixed ? 1 : 0, smooth);
    if (this.video) { this.video.muted = separate; this.video.volume = separate ? 0 : system; }
    this.original = !!project.media.microphone && !mixed && this.microphone.url === project.media.microphone
      && (!prepared.ready || !!project.audio.microphoneEffects?.enabled);
    this.changed();
  }

  dispose(): void {
    this.system.dispose(); this.microphone.dispose(); this.mix.dispose();
    this.project = undefined; this.prepared = undefined; this.video = undefined; this.identity = undefined; this.original = false;
    this.mixScopes.clear(); this.requestedMix = undefined;
  }
}
