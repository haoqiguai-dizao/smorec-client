import { app, net } from 'electron';
import { createReadStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { BoardSpeechModelState } from '../../../shared/whiteboard/types';
import { speechModelFiles, speechModelSources, type SpeechModelFile } from './speech-model-files';
import { downloadSpeechFile, type SpeechModelFetch } from './speech-model-download';
import { diagnostic } from '../diagnostics';

async function valid(file: string, expected: SpeechModelFile): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => undefined);
  if (!stat?.isFile() || stat.size !== expected.bytes) return false;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === expected.sha256;
}

export class SpeechModel {
  onState?: () => void;
  private installing?: Promise<void>;
  private verified = false;
  private checking?: Promise<boolean>;
  private lastPublished = 0;
  private state: BoardSpeechModelState;
  constructor(private options: { directory?: () => string; files?: SpeechModelFile[];
    sources?: string[]; fetcher?: SpeechModelFetch } = {}) {
    this.state = { phase: 'missing', received: 0, total: this.files.reduce((sum, file) => sum + file.bytes, 0) };
  }
  private get files() { return this.options.files ?? speechModelFiles; }
  private directory(): string { return this.options.directory?.() ?? path.join(app.getPath('userData'), 'models', 'sensevoice-fast'); }
  snapshot(): BoardSpeechModelState { return { ...this.state }; }
  private publish(phase: BoardSpeechModelState['phase'], received = this.state.received, error?: string) {
    const changed = this.state.phase !== phase;
    this.state = { phase, received, total: this.state.total, ...(error ? { error } : {}) };
    if (changed || phase !== 'downloading' || Date.now() - this.lastPublished >= 100) {
      this.lastPublished = Date.now(); this.onState?.();
    }
  }
  paths(): { model: string; tokens: string } {
    const directory = this.directory();
    return { model: path.join(directory, this.files[0].name), tokens: path.join(directory, this.files[1].name) };
  }
  async ready(): Promise<boolean> {
    if (this.verified) return true;
    if (this.installing) return false;
    this.checking ??= this.verify().finally(() => { this.checking = undefined; });
    return this.checking;
  }
  private async verify(): Promise<boolean> {
    const directory = this.directory();
    for (const file of this.files) {
      if (!(await valid(path.join(directory, file.name), file))) return false;
    }
    this.verified = true;
    this.publish('ready', this.state.total);
    return true;
  }
  async install(): Promise<void> {
    if (await this.ready()) return;
    if (!this.installing) this.installing = this.download().catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      this.publish('error', this.state.received, message);
      diagnostic('whiteboard.speech.download-failed', error);
      throw error;
    }).finally(() => { this.installing = undefined; });
    return this.installing;
  }
  private async download(): Promise<void> {
    const directory = this.directory();
    await fs.mkdir(directory, { recursive: true });
    let completed = 0;
    this.publish('downloading', 0);
    for (const file of this.files) {
      const target = path.join(directory, file.name);
      if (await valid(target, file)) { completed += file.bytes; this.publish('downloading', completed); continue; }
      const temporary = `${target}.download`;
      let failure: unknown, installed = false;
      for (const base of this.options.sources ?? speechModelSources) {
        try {
          if (!(await valid(temporary, file))) await downloadSpeechFile(file, temporary, `${base}${file.name}`,
            this.options.fetcher ?? net.fetch.bind(net), bytes => this.publish('downloading', completed + bytes));
          if (!(await valid(temporary, file))) {
            await fs.rm(temporary, { force: true }); throw new Error('模型摘要不匹配，请重试下载');
          }
          await fs.rename(temporary, target); installed = true; break;
        } catch (error) { failure = error; }
      }
      if (!installed) throw failure ?? new Error('模型下载失败，请重试');
      completed += file.bytes;
    }
    this.verified = true;
    this.publish('ready', this.state.total);
  }
}
