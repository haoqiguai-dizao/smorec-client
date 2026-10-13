import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { createHash } from 'node:crypto';

interface PcmFormat { sampleRate: number; channels: number; samples: number }
const operations = new Set<AbortController>();
let active = 0;
const waiting = new Set<() => void>();
async function acquire(signal: AbortSignal): Promise<() => void> {
  while (active >= 4) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => { waiting.delete(wake); signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => { waiting.delete(wake); reject(new DOMException('声音解码已取消', 'AbortError')); };
      waiting.add(wake); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
  }
  signal.throwIfAborted(); active++;
  return () => { active--; for (const wake of [...waiting]) wake(); };
}
export function cancelPcmDecoders(): void { for (const operation of operations) operation.abort(); }
/** Decode only the requested frames, with bounded pipe buffers and at most four workers. */
export async function floatPcmStream(executable: string, file: string, info: PcmFormat,
  firstFrame = 0, frames = info.samples, signal?: AbortSignal): Promise<{ stream: Transform; closed: Promise<void> }> {
  const controller = new AbortController(); operations.add(controller);
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let release: (() => void) | undefined;
  try {
    release = await acquire(combined); combined.throwIfAborted();
    const child = spawn(executable, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1',
      '-ss', (firstFrame / info.sampleRate).toFixed(12), '-i', file, '-t', (frames / info.sampleRate).toFixed(12),
      '-map', '0:a:0', '-c:a', 'pcm_f32le', '-threads', '1', '-f', 'f32le', 'pipe:1'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const expected = frames * info.channels * 4;
    let count = 0, stderr = '', failure: Error | undefined, escalation: ReturnType<typeof setTimeout> | undefined;
    const stream = new Transform({ highWaterMark: 64 * 1024, transform(bytes: Buffer, _encoding, done) {
      clearTimeout(timer);
      count += bytes.length; done(count > expected ? new Error('声音解码采样数超出范围') : null, bytes);
    } });
    stream.on('error', () => {}); // Consumers receive the error even when spawn fails before they attach.
    // The decoder's close event, rather than stdout end, confirms both success and file release.
    child.stdout.pipe(stream, { end: false });
    const abort = () => {
      // Close a backpressured pipe as well: SIGTERM alone can leave FFmpeg blocked writing stdout.
      child.stdout.destroy(); child.kill(); escalation ??= setTimeout(() => child.kill('SIGKILL'), 2000); escalation.unref();
    };
    const onAbort = () => { failure = new DOMException('声音解码已取消', 'AbortError'); stream.destroy(failure); abort(); };
    combined.addEventListener('abort', onAbort, { once: true }); if (combined.aborted) onAbort();
    stream.once('close', () => { if (child.exitCode === null) abort(); });
    child.stderr.on('data', (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-4000); });
    child.once('error', error => { failure = error; });
    // A long or paused preview must not inherit a processing wall-clock deadline.
    const timer = setTimeout(() => { failure = new Error('声音解码启动超时'); stream.destroy(failure); abort(); }, 20_000); timer.unref();
    const closed = new Promise<void>(resolve => child.once('close', code => {
      clearTimeout(timer); clearTimeout(escalation); combined.removeEventListener('abort', onAbort);
      release!(); operations.delete(controller);
      if (!stream.destroyed) {
        if (failure || code !== 0 || count !== expected) stream.destroy(failure ?? new Error(`声音解码失败：${stderr || '采样数不一致'}`));
        else stream.end();
      }
      resolve();
    }));
    return { stream, closed };
  } catch (error) { release?.(); operations.delete(controller); throw error; }
}
export async function floatPcmMetrics(executable: string, file: string, info: PcmFormat, signal?: AbortSignal): Promise<{ hash: string; peak: number }> {
  const decoder = await floatPcmStream(executable, file, info, 0, info.samples, signal);
  const hash = createHash('sha256'); let peak = 0, tail: Buffer = Buffer.alloc(0);
  try {
    for await (const chunk of decoder.stream) {
      const bytes = chunk as Buffer; hash.update(bytes);
      const joined = tail.length ? Buffer.concat([tail, bytes]) : bytes, length = joined.length - joined.length % 4;
      for (let offset = 0; offset < length; offset += 4) {
        const value = joined.readFloatLE(offset);
        if (!Number.isFinite(value)) throw new Error('声音处理产生了无效采样');
        peak = Math.max(peak, Math.abs(value));
      }
      tail = Buffer.from(joined.subarray(length));
    }
    if (tail.length) throw new Error('声音解码数据不完整');
    return { hash: hash.digest('hex'), peak };
  } finally { decoder.stream.destroy(); await decoder.closed; }
}
