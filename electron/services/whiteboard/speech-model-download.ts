import { createWriteStream, promises as fs } from 'node:fs';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { SpeechModelFile } from './speech-model-files';
export type SpeechModelFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Resume only the pinned file. A final SHA-256 check remains mandatory before use. */
export async function downloadSpeechFile(file: SpeechModelFile, temporary: string, url: string,
  fetcher: SpeechModelFetch, progress: (bytes: number) => void): Promise<void> {
  let start = await fs.stat(temporary).then(stat => stat.size).catch(() => 0);
  if (start >= file.bytes) { await fs.rm(temporary, { force: true }); start = 0; }
  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout>;
  const touch = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(new Error('下载长时间没有响应')), 30_000); };
  const deadline = setTimeout(() => controller.abort(new Error('下载超时，请重试')), 15 * 60_000);
  touch();
  try {
    const response = await fetcher(url, { signal: controller.signal,
      headers: start ? { Range: `bytes=${start}-` } : {} });
    if (!response.ok || !response.body) throw new Error(`下载失败：HTTP ${response.status}`);
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
      if (!range || Number(range[1]) !== start || Number(range[3]) !== file.bytes) {
        await response.body.cancel(); throw new Error('下载续传响应无效');
      }
    } else if (response.status === 200) start = 0;
    else { await response.body.cancel(); throw new Error('下载响应无效'); }
    const length = Number(response.headers.get('content-length'));
    if (length && length !== file.bytes - start) {
      await response.body.cancel(); throw new Error('模型大小不符合预期');
    }
    let received = start; progress(received);
    const meter = new Transform({ transform(chunk: Buffer, _encoding, next) {
      received += chunk.length; touch();
      if (received > file.bytes) { next(new Error('模型大小超过预期')); return; }
      progress(received); next(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), meter,
      createWriteStream(temporary, { flags: start ? 'a' : 'w', mode: 0o600 }), { signal: controller.signal });
    if (received !== file.bytes) throw new Error('下载未完成，请重试');
  } finally { clearTimeout(idle!); clearTimeout(deadline); }
}
