import { app } from 'electron';
import path from 'node:path';
import type { Project } from '../../shared/types';
import { audioMixGains } from '../../shared/audio-mix';
import { ffmpegPath } from './ffmpeg';
import { resolveProcessedMicrophone } from './microphone-effects';
import { safeMedia, type StoredProject } from './projects';
import { ProjectAudioMixCache, type ProjectAudioInput } from './project-audio/cache';
import { waveChannels } from './project-audio/source';
import { audioCacheManager } from './audio-cache';
import type { AudioCacheLease } from './audio-cache-manager';

let cache: ProjectAudioMixCache | undefined;

/** Paths and duration come exclusively from the main-process project store. */
export async function resolveProjectAudio(stored: StoredProject, audio: Project['audio'], signal?: AbortSignal, lease?: AudioCacheLease): Promise<ProjectAudioInput | undefined> {
  const { project, directory } = stored, inputs: ProjectAudioInput[] = [];
  const [system, microphone] = audioMixGains([audio.system, audio.microphone]);
  const systemFile = project.media.systemAudio ?? (stored.embeddedAudio ? project.media.screen : undefined);
  if (systemFile) inputs.push({ path: await safeMedia(directory, systemFile), volume: system });
  if (project.media.microphone) {
    const source = await safeMedia(directory, project.media.microphone);
    inputs.push({ path: await resolveProcessedMicrophone(source, audio.microphoneEffects, signal, lease), volume: microphone });
  }
  signal?.throwIfAborted();
  if (inputs.length < 2) return inputs[0] ? { ...inputs[0], channels: await waveChannels(inputs[0].path) } : undefined;
  cache ??= new ProjectAudioMixCache({ directory: path.join(app.getPath('userData'), 'cache', 'project-audio'), executable: ffmpegPath, maintenance: audioCacheManager() });
  return { path: await cache.resolve(inputs, project.duration, signal, lease), volume: 1, channels: 2 };
}
export function cancelProjectAudio(): void { cache?.cancelAll(); }
export function disposeProjectAudio(): void { cache?.dispose(); cache = undefined; }
