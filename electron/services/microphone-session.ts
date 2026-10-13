import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NativeClient } from './native-client';
import type { ProjectStore } from './projects';
import { normalizeMicrophoneEffects } from '../../shared/microphone-effects';
import { resolveProcessedMicrophone } from './microphone-effects';
import { resolveProjectAudio } from './project-audio';
import { audioMixGains } from '../../shared/audio-mix';
import { object, projectId, string } from './validation';
import { audioCacheManager } from './audio-cache';
import type { AudioCacheLease } from './audio-cache-manager';

interface Trial { id: string; directory: string; client: NativeClient; duration?: number; raw?: string }

/** Issues opaque media URLs only for audio selected by trusted project/trial services. */
export class MicrophoneSession {
  private assets = new Map<string, { file: string; lease: AudioCacheLease; controller: AbortController; trialId?: string }>();
  private projectJob?: AbortController;
  private trialJob?: AbortController;
  private trial?: Trial;
  private trialStarting = false;
  private trialGeneration = 0;
  private trialClosing?: Promise<void>;
  constructor(private projects: ProjectStore) {}

  media(token: string): string {
    const asset = this.assets.get(token);
    if (!asset) throw new Error('试听文件已过期');
    return asset.file;
  }
  mediaSignal(token: string): AbortSignal {
    const asset = this.assets.get(token); if (!asset) throw new Error('试听文件已过期'); return asset.controller.signal;
  }
  private publish(file: string, lease = audioCacheManager().lease(), trialId?: string): string {
    lease.pin(file);
    const token = randomUUID(); this.assets.set(token, { file, lease, trialId, controller: new AbortController() });
    return `frameflow://audio/${token}`;
  }
  releaseMedia(value: unknown): void {
    if (typeof value !== 'string' || !/^frameflow:\/\/audio\/[a-f0-9-]{36}$/.test(value)) return;
    const token = value.slice('frameflow://audio/'.length), asset = this.assets.get(token);
    asset?.controller.abort(); asset?.lease.release(); this.assets.delete(token);
  }
  cancelPreparation(): void { this.projectJob?.abort(); this.projectJob = undefined; }
  async prepareProject(id: unknown, value: unknown): Promise<string> {
    this.cancelPreparation();
    const job = new AbortController(); this.projectJob = job;
    const lease = audioCacheManager().lease(); let published = false;
    try {
      const file = await this.projects.media(projectId(id), 'microphone');
      const result = await resolveProcessedMicrophone(file, normalizeMicrophoneEffects(object(value)), job.signal, lease);
      job.signal.throwIfAborted();
      const url = this.publish(result, lease); published = true; return url;
    } finally { if (!published) lease.release(); if (this.projectJob === job) this.projectJob = undefined; }
  }
  async prepareAudio(id: unknown, value: unknown): Promise<string> {
    this.cancelPreparation();
    const job = new AbortController(); this.projectJob = job;
    const lease = audioCacheManager().lease(); let published = false;
    try {
      const stored = this.projects.get(projectId(id)), input = object(value);
      const [system, microphone] = audioMixGains([Number(input.system), Number(input.microphone)]);
      const result = await resolveProjectAudio(stored, { system, microphone,
        microphoneEffects: normalizeMicrophoneEffects(input.microphoneEffects) }, job.signal, lease);
      job.signal.throwIfAborted();
      if (!result) throw new Error('工程没有声音音轨');
      const url = this.publish(result.path, lease); published = true; return url;
    } finally { if (!published) lease.release(); if (this.projectJob === job) this.projectJob = undefined; }
  }
  async startTrial(value: unknown): Promise<{ id: string }> {
    if (this.trialStarting) throw new Error('麦克风正在准备，请稍候');
    const deviceId = value === '' ? '' : string(value, 1024);
    this.trialStarting = true;
    const generation = ++this.trialGeneration;
    try {
      await this.releaseTrial();
      if (generation !== this.trialGeneration) throw new Error('麦克风试录已取消');
      const directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'smorec-microphone-'));
      if (generation !== this.trialGeneration) {
        await fs.rmdir(directory).catch(() => {});
        throw new Error('麦克风试录已取消');
      }
      const trial: Trial = { id: randomUUID(), directory, client: new NativeClient() };
      this.trial = trial;
      await trial.client.request('microphone-trial-start', { directory, deviceId });
      if (this.trial !== trial) throw new Error('麦克风试录已取消');
      return { id: trial.id };
    } catch (error) { await this.cancelTrial(); throw error; }
    finally { this.trialStarting = false; }
  }
  private getTrial(id: unknown): Trial {
    if (!this.trial || this.trial.id !== projectId(id)) throw new Error('麦克风试录已结束，请重新试录');
    return this.trial;
  }
  async finishTrial(id: unknown): Promise<{ id: string; url: string; duration: number }> {
    const trial = this.getTrial(id);
    if (!trial.raw) {
      try {
        const result = await trial.client.request<{ duration: number }>('microphone-trial-stop');
        if (this.trial !== trial) throw new Error('麦克风试录已取消');
        if (!Number.isFinite(result.duration) || result.duration <= 0 || result.duration > 20) throw new Error('试录时长无效');
        trial.duration = result.duration;
        trial.raw = path.join(trial.directory, 'microphone.wav');
        await trial.client.shutdownGracefully();
      } catch (error) {
        await this.cancelTrial(trial.id);
        throw error;
      }
    }
    return { id: trial.id, url: this.publish(trial.raw, undefined, trial.id), duration: trial.duration! };
  }
  async processTrial(id: unknown, value: unknown): Promise<string> {
    const trial = this.getTrial(id);
    if (!trial.raw) throw new Error('请先结束试录');
    this.trialJob?.abort();
    const job = new AbortController(); this.trialJob = job;
    const lease = audioCacheManager().lease(); let published = false;
    try {
      const file = await resolveProcessedMicrophone(trial.raw, normalizeMicrophoneEffects(object(value)), job.signal, lease);
      job.signal.throwIfAborted();
      if (this.trial !== trial) throw new Error('麦克风试录已取消');
      const url = this.publish(file, lease, trial.id); published = true; return url;
    } finally { if (!published) lease.release(); if (this.trialJob === job) this.trialJob = undefined; }
  }
  async cancelTrial(id?: unknown): Promise<void> {
    if (id !== undefined && (!this.trial || this.trial.id !== projectId(id))) return;
    this.trialGeneration++;
    await this.releaseTrial();
  }
  private async releaseTrial(): Promise<void> {
    this.trialJob?.abort(); this.trialJob = undefined;
    const trial = this.trial; this.trial = undefined;
    if (!trial) { await this.trialClosing; return; }
    const closing = (async () => {
      await trial.client.shutdownGracefully();
      for (const [token, asset] of this.assets) if (asset.trialId === trial.id) this.releaseMedia(`frameflow://audio/${token}`);
      if (trial.raw) await audioCacheManager().clearForSource(trial.raw).catch(() => {});
      // Only our explicitly named trial files can be removed; no recursive path deletion.
      for (const name of ['microphone.wav', 'microphone.recovery.wav', 'capture.log']) {
        const file = path.join(trial.directory, name);
        for (const [token, asset] of this.assets) if (asset.file === file) this.releaseMedia(`frameflow://audio/${token}`);
        await fs.rm(file, { force: true }).catch(() => {});
      }
      await fs.rmdir(trial.directory).catch(() => {});
    })();
    this.trialClosing = closing;
    try { await closing; } finally { if (this.trialClosing === closing) this.trialClosing = undefined; }
  }
  async suspend(): Promise<void> {
    this.cancelPreparation(); await this.cancelTrial();
    for (const token of this.assets.keys()) this.releaseMedia(`frameflow://audio/${token}`);
  }
}
