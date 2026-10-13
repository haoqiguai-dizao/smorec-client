import type { Project } from '../../shared/types';
import { compositionAt } from '../../shared/compositions';
import { effectiveBackground } from '../../shared/backgrounds';
import { abortError } from './media';

export class CompositionBackgroundCache {
  private images = new Map<string, ImageBitmap>();
  private pending = new Map<string, Promise<ImageBitmap>>();
  private controller = new AbortController();
  private activeLoads = 0;
  private waiting: (() => void)[] = [];

  key(project: Project, time: number): string | undefined {
    const segment = compositionAt(project.compositions, time);
    const background = effectiveBackground(project.style?.background, segment);
    if (!background?.startsWith('asset:')) return;
    const asset = project.backgrounds?.find(item => item.id === background.slice(6));
    if (!asset) throw new Error('替换背景图片不存在，请重新选择');
    return asset.src;
  }

  peek(project: Project, time: number): ImageBitmap | undefined {
    const key = this.key(project, time);
    return key ? this.images.get(key) : undefined;
  }

  async prepare(project: Project, time: number, signal?: AbortSignal): Promise<ImageBitmap | undefined> {
    const key = this.key(project, time);
    if (!key) return;
    if (signal?.aborted || this.controller.signal.aborted) throw abortError();
    const existing = this.images.get(key);
    if (existing) {
      this.images.delete(key); this.images.set(key, existing);
      return existing;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const operation = this.load(key, signal).finally(() => this.pending.delete(key));
    this.pending.set(key, operation);
    return operation;
  }

  private async load(key: string, signal?: AbortSignal): Promise<ImageBitmap> {
    if (this.activeLoads >= 2) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.activeLoads++;
    try {
    const combined = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    if (combined.aborted) throw abortError();
    const response = await fetch(key, { signal: combined });
    if (!response.ok) throw new Error('替换背景图片无法读取，请重新打开工程');
    const image = await createImageBitmap(await response.blob());
    if (combined.aborted) { image.close(); throw abortError(); }
    this.images.set(key, image);
    // Background changes do not keep an entire project's full-resolution images in GPU memory.
    while (this.images.size > 2) {
      const oldest = this.images.keys().next().value!;
      this.images.get(oldest)!.close(); this.images.delete(oldest);
    }
    return image;
    } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.activeLoads--;
    }
  }

  dispose(): void {
    this.controller.abort();
    this.images.forEach(image => image.close()); this.images.clear(); this.pending.clear();
  }
}
