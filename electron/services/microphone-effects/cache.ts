import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { normalizeMicrophoneEffects } from '../../../shared/microphone-effects';
import { dbGain, MICROPHONE_PROCESSING_VERSION, microphoneFilterGraph } from './filters';
import { runMicrophoneProcess } from './process';
import { floatWavePeak, readWaveInfo, type WaveInfo } from './wave';
import type { AudioCacheLease, AudioCacheManager } from '../audio-cache-manager';
import { audioEncoderIdentity, audioSourceHash } from '../audio-fingerprint';
import { storeFloatWave, validAudioStorage, type AudioStorageMetadata } from '../audio-storage';

export interface MicrophoneCacheMetadata {
  version: number; key: string; sourceHash: string; sampleRate: number; channels: number;
  samples: number; peak: number; safetyGain: number; storage?: AudioStorageMetadata;
}
interface Job { controller: AbortController; consumers: Set<symbol>; promise: Promise<string> }
interface CacheOptions { directory: string; executable: () => string; maintenance?: AudioCacheManager }

async function fingerprint(file: string, signal?: AbortSignal): Promise<string> {
  return audioSourceHash(file, signal);
}
function sameFormat(actual: WaveInfo, expected: WaveInfo): void {
  if (actual.sampleRate !== expected.sampleRate || actual.channels !== expected.channels || actual.samples !== expected.samples
    || actual.encoding !== 3 || actual.bitsPerSample !== 32) throw new Error('麦克风效果处理后的采样数或格式与原片不一致');
}

/** Immutable, content-addressed output. Aborting one reader never cancels another reader's shared job. */
export class MicrophoneEffectsCache {
  private jobs = new Map<string, Job>();
  private operations = new Set<AbortController>();
  private disposed = false;
  constructor(private options: CacheOptions) {}

  async resolve(source: string, value: unknown, signal?: AbortSignal, lease?: AudioCacheLease): Promise<string> {
    const controller = new AbortController(); this.operations.add(controller);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try { return await this.resolveActive(source, value, combined, lease); }
    finally { this.operations.delete(controller); }
  }

  private async resolveActive(source: string, value: unknown, signal: AbortSignal, lease?: AudioCacheLease): Promise<string> {
    signal?.throwIfAborted();
    if (this.disposed) throw new Error('麦克风效果服务已关闭');
    const effects = normalizeMicrophoneEffects(value);
    if (!effects.enabled) return source;
    const info = await readWaveInfo(source), filters = microphoneFilterGraph(effects, info.sampleRate, info.samples);
    if (!filters) return source;
    const sourceHash = await fingerprint(source, signal), executable = this.options.executable();
    const binary = await audioEncoderIdentity(executable);
    const key = createHash('sha256').update(JSON.stringify({ sourceHash, filters, info: [info.sampleRate, info.channels, info.samples],
      version: MICROPHONE_PROCESSING_VERSION, binary, storageVersion: 1 })).digest('hex');
    signal?.throwIfAborted();
    if (this.disposed) throw new Error('麦克风效果服务已关闭');
    lease?.pin(path.join(path.resolve(this.options.directory), `${key}.wav`));
    lease?.pin(path.join(path.resolve(this.options.directory), `${key}.wv`));
    let job = this.jobs.get(key);
    if (!job || job.controller.signal.aborted) {
      const controller = new AbortController();
      const created: Job = { controller, consumers: new Set(), promise: Promise.resolve('') };
      // The asynchronous task cannot publish until a consumer has attached in the current turn.
      created.promise = this.prepare(source, sourceHash, info, filters, key, executable, controller.signal)
        .finally(() => { if (this.jobs.get(key) === created) this.jobs.delete(key); });
      created.promise.catch(() => undefined);
      this.jobs.set(key, created); job = created;
    }
    return this.consume(job, signal);
  }

  private consume(job: Job, signal?: AbortSignal): Promise<string> {
    const consumer = Symbol(); job.consumers.add(consumer);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error?: unknown, file?: string) => {
        if (done) return;
        done = true; signal?.removeEventListener('abort', abort); job.consumers.delete(consumer);
        if (error) reject(error); else resolve(file!);
      };
      const abort = () => {
        finish(new DOMException('麦克风效果处理已取消', 'AbortError'));
        if (!job.consumers.size) job.controller.abort();
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      job.promise.then(file => finish(undefined, file), error => finish(error));
    });
  }

  private async existing(file: string, key: string, expected: WaveInfo, signal: AbortSignal): Promise<boolean> {
    try {
      const metadata = JSON.parse(await fs.readFile(`${file}.json`, 'utf8')) as MicrophoneCacheMetadata;
      if (metadata.key !== key || metadata.version !== MICROPHONE_PROCESSING_VERSION
        || metadata.samples !== expected.samples || metadata.sampleRate !== expected.sampleRate || metadata.channels !== expected.channels) return false;
      const info = await readWaveInfo(file); sameFormat(info, expected);
      if (!await validAudioStorage(file, metadata.storage, signal)) return false;
      return Number.isFinite(metadata.peak) && metadata.peak <= 1.000001 && (metadata.storage !== undefined
        || Math.abs(await floatWavePeak(file, info, signal) - metadata.peak) < 1e-6);
    } catch (error) { if (signal.aborted) throw error; return false; }
  }

  private async prepare(source: string, sourceHash: string, info: WaveInfo, filters: string, key: string,
    executable: string, signal: AbortSignal): Promise<string> {
    const directory = path.resolve(this.options.directory), output = path.join(directory, `${key}.wav`);
    const protection = this.options.maintenance?.lease(); protection?.pin(output);
    protection?.pin(path.join(directory, `${key}.wv`));
    try {
      await this.options.maintenance?.ready();
      return await this.prepareOutput(source, sourceHash, info, filters, key, executable, signal);
    } finally { protection?.release(); }
  }

  private async prepareOutput(source: string, sourceHash: string, info: WaveInfo, filters: string, key: string,
    executable: string, signal: AbortSignal): Promise<string> {
    const directory = path.resolve(this.options.directory);
    signal.throwIfAborted();
    await fs.mkdir(directory, { recursive: true });
    for (const extension of ['wv', 'wav']) {
      const existing = path.join(directory, `${key}.${extension}`);
      if (await this.existing(existing, key, info, signal)) {
        await this.options.maintenance?.published(existing, await this.options.maintenance.sourcesFor(source, sourceHash));
        return existing;
      }
    }
    const temporary = path.join(directory, `${key}.${randomUUID()}.part.wav`), scaled = `${temporary}.scaled.wav`;
    const packed = `${temporary}.wv`, manifest = `${temporary}.json`, before = await fs.stat(source);
    const argumentsFor = (input: string, graph: string, destination: string) => ['-threads', '1', '-filter_threads', '1', '-y',
      '-i', input, '-map', '0:a:0', '-vn', '-af', graph, '-ar', String(info.sampleRate), '-ac', String(info.channels),
      '-c:a', 'pcm_f32le', '-threads', '1', '-rf64', 'auto', '-f', 'wav', destination];
    try {
      await this.options.maintenance?.beginWork(temporary);
      await runMicrophoneProcess(executable, argumentsFor(source, filters, temporary), signal);
      const processedInfo = await readWaveInfo(temporary); sameFormat(processedInfo, info);
      let peak = await floatWavePeak(temporary, processedInfo, signal), safetyGain = 1, candidate = temporary;
      if (peak > 1) {
        // With the optional limiter off, preserve the shape with one static gain instead of clipping.
        safetyGain = dbGain(-1) / peak;
        await runMicrophoneProcess(executable, argumentsFor(temporary, `volume=${safetyGain.toFixed(12)}`, scaled), signal);
        const scaledInfo = await readWaveInfo(scaled); sameFormat(scaledInfo, info);
        peak = await floatWavePeak(scaled, scaledInfo, signal); candidate = scaled;
      }
      if (peak > 1.000001) throw new Error('麦克风处理后的峰值超出安全范围，请恢复原声后重试');
      const stored = await storeFloatWave(candidate, packed, executable, await readWaveInfo(candidate), signal);
      const after = await fs.stat(source);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
        || await fingerprint(source, signal) !== sourceHash) throw new Error('麦克风原片已变化，请重新处理');
      const metadata: MicrophoneCacheMetadata = { version: MICROPHONE_PROCESSING_VERSION, key, sourceHash,
        samples: info.samples, sampleRate: info.sampleRate, channels: info.channels, peak, safetyGain, storage: stored.storage };
      await fs.writeFile(manifest, JSON.stringify(metadata));
      signal.throwIfAborted();
      const output = path.join(directory, `${key}.${stored.storage.format === 'wavpack-float32' ? 'wv' : 'wav'}`);
      await fs.rename(stored.file, output);
      await fs.rename(manifest, `${output}.json`);
      await this.options.maintenance?.published(output, await this.options.maintenance.sourcesFor(source, sourceHash));
      signal.throwIfAborted();
      return output;
    } finally {
      await Promise.all([temporary, scaled, packed, manifest, `${temporary}.work.json`].map(file => fs.rm(file, { force: true }).catch(() => undefined)));
    }
  }

  /** Used before capture starts as well as shutdown; the next resolve may still be used. */
  cancelAll(): void {
    for (const operation of this.operations) operation.abort();
    for (const job of this.jobs.values()) job.controller.abort();
  }
  dispose(): void { this.disposed = true; this.cancelAll(); }
}
