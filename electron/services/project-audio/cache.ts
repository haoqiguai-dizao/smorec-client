import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { AUDIO_MIX_PEAK } from '../../../shared/audio-mix';
import { runMicrophoneProcess } from '../microphone-effects/process';
import { floatWavePeak, readWaveInfo } from '../microphone-effects/wave';
import { PROJECT_AUDIO_RATE, PROJECT_AUDIO_VERSION, projectAudioFilters } from './filters';
import { waveChannels } from './source';
import type { AudioCacheLease, AudioCacheManager } from '../audio-cache-manager';
import { audioEncoderIdentity, audioSourceHash } from '../audio-fingerprint';
import { storeUncompressedFloatWave, validAudioStorage, type AudioStorageMetadata } from '../audio-storage';

export interface ProjectAudioInput { path: string; volume: number; channels?: number }
interface Options { directory: string; executable: () => string; maintenance?: AudioCacheManager }
interface Job { controller: AbortController; consumers: Set<symbol>; promise: Promise<string> }
interface Metadata { version: number; key: string; samples: number; peak: number; storage?: AudioStorageMetadata }

async function fingerprint(file: string, signal: AbortSignal): Promise<string> {
  return audioSourceHash(file, signal);
}

/** Immutable mixed PCM shared by preview and export, with independent cancellation. */
export class ProjectAudioMixCache {
  private jobs = new Map<string, Job>();
  private operations = new Set<AbortController>();
  private disposed = false;
  constructor(private options: Options) {}

  async resolve(inputs: readonly ProjectAudioInput[], duration: number, signal?: AbortSignal, lease?: AudioCacheLease): Promise<string> {
    const operation = new AbortController(); this.operations.add(operation);
    const combined = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
    try {
      combined.throwIfAborted();
      if (this.disposed) throw new Error('声音混音服务已关闭');
      const channels = await Promise.all(inputs.map(input => waveChannels(input.path)));
      const samples = Math.round(duration * PROJECT_AUDIO_RATE), filters = projectAudioFilters(inputs.map(input => input.volume), samples, channels);
      const fingerprints = await Promise.all(inputs.map(input => fingerprint(input.path, combined)));
      const executable = this.options.executable(), binary = await audioEncoderIdentity(executable);
      const key = createHash('sha256').update(JSON.stringify({ fingerprints, filters, version: PROJECT_AUDIO_VERSION,
        binary, storageVersion: 2 })).digest('hex');
      combined.throwIfAborted();
      lease?.pin(path.join(path.resolve(this.options.directory), `${key}.wav`));
      lease?.pin(path.join(path.resolve(this.options.directory), `${key}.wv`));
      let job = this.jobs.get(key);
      if (!job || job.controller.signal.aborted) {
        const created: Job = { controller: new AbortController(), consumers: new Set(), promise: Promise.resolve('') };
        created.promise = this.prepare(inputs, fingerprints, samples, filters, key, executable, created.controller.signal)
          .finally(() => { if (this.jobs.get(key) === created) this.jobs.delete(key); });
        created.promise.catch(() => undefined); this.jobs.set(key, created); job = created;
      }
      return await this.consume(job, combined);
    } finally { this.operations.delete(operation); }
  }

  private consume(job: Job, signal: AbortSignal): Promise<string> {
    const consumer = Symbol(); job.consumers.add(consumer);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, file?: string) => {
        if (done) return;
        done = true; signal.removeEventListener('abort', abort); job.consumers.delete(consumer);
        if (error) reject(error); else resolve(file!);
      };
      const abort = () => {
        finish(new DOMException('声音混音已取消', 'AbortError'));
        if (!job.consumers.size) job.controller.abort();
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) { abort(); return; }
      job.promise.then(file => finish(undefined, file), error => finish(error));
    });
  }

  private async validate(file: string, samples: number, signal: AbortSignal): Promise<number> {
    const info = await readWaveInfo(file);
    if (info.sampleRate !== PROJECT_AUDIO_RATE || info.channels !== 2 || info.samples !== samples
      || info.encoding !== 3 || info.bitsPerSample !== 32) throw new Error('声音混音格式或长度不正确');
    const peak = await floatWavePeak(file, info, signal);
    if (peak > AUDIO_MIX_PEAK + 1e-6) throw new Error('声音混音峰值超出安全范围');
    return peak;
  }

  private async prepare(inputs: readonly ProjectAudioInput[], fingerprints: string[], samples: number,
    filters: string, key: string, executable: string, signal: AbortSignal): Promise<string> {
    const directory = path.resolve(this.options.directory), output = path.join(directory, `${key}.wav`);
    const protection = this.options.maintenance?.lease(); protection?.pin(output);
    protection?.pin(path.join(directory, `${key}.wv`));
    try {
      await this.options.maintenance?.ready();
      return await this.prepareOutput(inputs, fingerprints, samples, filters, key, executable, signal);
    } finally { protection?.release(); }
  }

  private async prepareOutput(inputs: readonly ProjectAudioInput[], fingerprints: string[], samples: number,
    filters: string, key: string, executable: string, signal: AbortSignal): Promise<string> {
    const directory = path.resolve(this.options.directory);
    await fs.mkdir(directory, { recursive: true }); signal.throwIfAborted();
    const sources = this.options.maintenance ? (await Promise.all(inputs.map((input, index) =>
      this.options.maintenance!.sourcesFor(input.path, fingerprints[index])))) : [];
    // A mix is regenerable only when every input resolves to original media.
    const originals = sources.every(group => group.length > 0) ? sources.flat() : [];
    for (const extension of ['wv', 'wav']) {
      const output = path.join(directory, `${key}.${extension}`);
      try {
        const metadata = JSON.parse(await fs.readFile(`${output}.json`, 'utf8')) as Metadata, info = await readWaveInfo(output);
        if (metadata.key === key && metadata.version === PROJECT_AUDIO_VERSION && metadata.samples === samples
          && info.samples === samples && info.channels === 2 && info.sampleRate === PROJECT_AUDIO_RATE
          && info.encoding === 3 && info.bitsPerSample === 32 && Number.isFinite(metadata.peak) && metadata.peak <= AUDIO_MIX_PEAK + 1e-6
          && await validAudioStorage(output, metadata.storage, signal)
          && (metadata.storage || Math.abs(await this.validate(output, samples, signal) - metadata.peak) < 1e-6)) {
          await this.options.maintenance?.published(output, originals, metadata.storage?.schema === 1); return output;
        }
      } catch (error) { if (signal.aborted) throw error; }
    }
    const temporary = path.join(directory, `${key}.${randomUUID()}.part.wav`), manifest = `${temporary}.json`;
    try {
      await this.options.maintenance?.beginWork(temporary);
      await runMicrophoneProcess(executable, ['-threads', '1', '-filter_complex_threads', '1', '-y',
        ...inputs.flatMap(input => ['-threads', '1', '-i', input.path]), '-filter_complex', filters, '-map', '[outa]',
        '-vn', '-ar', String(PROJECT_AUDIO_RATE), '-ac', '2', '-c:a', 'pcm_f32le', '-threads', '1', '-rf64', 'auto', temporary], signal);
      const peak = await this.validate(temporary, samples, signal);
      const stored = await storeUncompressedFloatWave(temporary, await readWaveInfo(temporary), signal);
      const latest = await Promise.all(inputs.map(input => fingerprint(input.path, signal)));
      if (latest.some((hash, index) => hash !== fingerprints[index])) throw new Error('音频原片已变化，请重新处理');
      await fs.writeFile(manifest, JSON.stringify({ version: PROJECT_AUDIO_VERSION, key, samples, peak, storage: stored.storage } satisfies Metadata));
      signal.throwIfAborted();
      const output = path.join(directory, `${key}.wav`);
      await fs.rename(stored.file, output); await fs.rename(manifest, `${output}.json`);
      await this.options.maintenance?.published(output, originals, true);
      signal.throwIfAborted(); return output;
    } finally { await Promise.all([temporary, manifest, `${temporary}.work.json`].map(file => fs.rm(file, { force: true }).catch(() => undefined))); }
  }

  cancelAll(): void {
    for (const operation of this.operations) operation.abort();
    for (const job of this.jobs.values()) job.controller.abort();
  }
  dispose(): void { this.disposed = true; this.cancelAll(); }
}
