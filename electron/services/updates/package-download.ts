import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { ReleaseArtifact, MacReleaseArtifact } from '../../../shared/update-types';
import { secureUrl } from './manifest';

/** Redirects may reach COS, but may never downgrade HTTPS or forward credentials. */
export async function downloadPackage(artifact: ReleaseArtifact | MacReleaseArtifact, destination: string, fetcher: typeof fetch,
  signal: AbortSignal, progress: (percent: number) => void): Promise<void> {
  let url = secureUrl(artifact.url), response: Response | undefined;
  for (let redirects = 0; redirects <= 5; redirects++) {
    response = await fetcher(url, { signal, redirect: 'manual', cache: 'no-store', credentials: 'omit' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const next = response.headers.get('location'); await response.body?.cancel();
    if (!next || redirects === 5) throw new Error('更新下载重定向无效');
    url = secureUrl(new URL(next, url).href);
  }
  if (!response?.ok || response.status !== 200 || !response.body) throw new Error('更新下载失败');
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) !== artifact.size) { await response.body.cancel(); throw new Error('更新包大小不符'); }
  const file = await fs.open(destination, 'wx');
  const reader = response.body.getReader();
  const sha256 = createHash('sha256'), sha512 = createHash('sha512'); let size = 0, lastPercent = -1;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > artifact.size) throw new Error('更新包超出登记大小');
      sha256.update(value); sha512.update(value);
      let offset = 0;
      while (offset < value.byteLength) offset += (await file.write(value, offset)).bytesWritten;
      const percent = Math.floor(size / artifact.size * 100);
      if (percent !== lastPercent) { lastPercent = percent; progress(percent); }
    }
    if (size !== artifact.size || sha256.digest('hex') !== artifact.sha256 || sha512.digest('base64') !== artifact.sha512) {
      throw new Error('更新包完整性校验失败');
    }
    await file.sync();
  } finally { await reader.cancel().catch(() => {}); await file.close(); }
}
