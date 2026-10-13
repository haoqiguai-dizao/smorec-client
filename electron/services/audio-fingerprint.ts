import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';

export async function audioFileHash(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file, { signal })) hash.update(bytes);
  signal?.throwIfAborted(); return hash.digest('hex');
}
const binaries = new Map<string, { stat: string; promise: Promise<string> }>();
const sources = new Map<string, { stat: string; promise: Promise<string> }>();
/** Completed sources are immutable. Recheck all filesystem identity fields before reusing their digest. */
export async function audioSourceHash(file: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted(); const before = await fs.stat(file);
  const stat = [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs].join(':');
  let entry = sources.get(file);
  if (entry?.stat !== stat) {
    const promise = audioFileHash(file).then(async hash => {
      const after = await fs.stat(file);
      if ([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(':') !== stat) throw new Error('音频原片已变化，请重试');
      return hash;
    });
    entry = { stat, promise }; sources.set(file, entry);
    void promise.catch(() => { if (sources.get(file)?.promise === promise) sources.delete(file); });
  }
  sources.delete(file); sources.set(file, entry);
  if (sources.size > 128) sources.delete(sources.keys().next().value!);
  if (!signal) return entry.promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('声音处理已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    entry!.promise.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
/** File times only invalidate the in-process memo; the persistent identity is the actual bytes. */
export async function audioEncoderIdentity(file: string): Promise<string> {
  const before = await fs.stat(file);
  const stat = [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs].join(':');
  const cached = binaries.get(file); if (cached?.stat === stat) return cached.promise;
  const promise = audioFileHash(file).then(async hash => {
    const after = await fs.stat(file);
    if ([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(':') !== stat) throw new Error('声音处理程序已变化，请重试');
    return hash;
  });
  binaries.set(file, { stat, promise });
  void promise.catch(() => { if (binaries.get(file)?.promise === promise) binaries.delete(file); });
  return promise;
}
